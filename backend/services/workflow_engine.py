"""
WorkflowEngine — DAG 工作流执行引擎。

支持节点类型：
- start: 开始节点
- end: 结束节点
- agent: Agent 执行（真实 CLI：通过 AgentExecutor 流式执行，完成后调用 on_task_completed）
- approval: 人工审批（等待 on_approval_resolved 回调）
- git_merge: Git 分支合并（支持 merge/squash/rebase 策略，冲突时可等待人工解决）
- condition: 条件分支（评估表达式选择边）
- parallel: 并行网关（fork，所有下游并行执行）
- parallel_join: 并行汇聚（等所有上游完成）
- delay: 延时节点（asyncio.sleep）
- stage: 阶段节点（工作项停留阶段，自动化执行时直接跳过）

主要回调：
- on_task_completed / on_task_failed
- on_approval_resolved
- on_merge_resolved
"""

import asyncio
import json
import logging
import re
import shutil
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.runtime.adapters import (
    AGENT_ADAPTERS,
    _build_prompt_with_knowledge,
    _build_prompt_with_rules,
    _build_prompt_with_skills,
)
from backend.runtime.executor import agent_executor
from backend.services.event_emitter import event_emitter
from backend.services.hook_engine import hook_engine
from backend.services.ws_hub import ws_hub

logger = logging.getLogger("tide.workflow_engine")

# 终态节点类型集合（无出边，到达即终止工作流）
TERMINAL_NODE_TYPES = {"end", "cancel", "error", "close"}

# 终态节点 → 工作流运行最终状态
TERMINAL_RUN_STATUS = {
    "end": "completed",
    "cancel": "cancelled",
    "error": "failed",
    "close": "completed",
}


def _safe_json_loads(raw, default):
    if raw is None or raw == "":
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class WorkflowEngine:
    def __init__(self):
        # run_id -> {"workflow_id", "workspace_id", "definition": {nodes, edges}}
        self._runs: dict[str, dict] = {}
        # node_run_id -> task_id mapping (also node_id keyed inside _runs for reverse lookup)

    # ── public API ───────────────────────────────────────

    async def start_run(
        self,
        workflow_id: str,
        input_context: Optional[dict] = None,
        trigger_type: str = "manual",
    ) -> str:
        """启动工作流运行。返回 run_id。"""
        # 1. 加载 workflow
        async with async_session_factory() as session:
            wf_row = (
                await session.execute(
                    text(
                        "SELECT id, workspace_id, definition FROM workflows WHERE id = :id"
                    ),
                    {"id": workflow_id},
                )
            ).fetchone()
        if not wf_row:
            raise ValueError(f"Workflow not found: {workflow_id}")

        wf = dict(wf_row._mapping)
        definition = _safe_json_loads(wf.get("definition"), {"nodes": [], "edges": []})
        nodes = definition.get("nodes", [])
        edges = definition.get("edges", [])

        # 2. 校验 DAG
        self._validate_dag(nodes, edges)

        # 3. 创建 workflow_runs
        run_id = str(uuid.uuid4())
        now = _now_iso()
        context = {"start": {"input": input_context or {}}}

        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO workflow_runs
                        (id, workflow_id, workspace_id, status, current_node_ids,
                         context, trigger_type, started_at)
                    VALUES (:id, :workflow_id, :workspace_id, 'running', :current_node_ids,
                            :context, :trigger_type, :started_at)
                    """
                ),
                {
                    "id": run_id,
                    "workflow_id": workflow_id,
                    "workspace_id": wf["workspace_id"],
                    "current_node_ids": json.dumps([]),
                    "context": json.dumps(context),
                    "trigger_type": trigger_type,
                    "started_at": now,
                },
            )

            # 4. 初始化所有 node_runs（status=pending）
            for node in nodes:
                await session.execute(
                    text(
                        """
                        INSERT INTO workflow_node_runs
                            (id, run_id, node_id, status)
                        VALUES (:id, :run_id, :node_id, 'pending')
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "run_id": run_id,
                        "node_id": node["id"],
                    },
                )
            await session.commit()

        # 5. 缓存运行上下文
        self._runs[run_id] = {
            "id": run_id,
            "workflow_id": workflow_id,
            "workspace_id": wf["workspace_id"],
            "status": "running",
            "definition": {"nodes": nodes, "edges": edges},
            "context": context,
        }

        await ws_hub.broadcast(
            "workflows",
            {
                "type": "workflow.run.started",
                "run_id": run_id,
                "workflow_id": workflow_id,
                "workspace_id": wf["workspace_id"],
            },
        )

        # 6. 找到 start 节点并执行
        start_nodes = [n for n in nodes if n.get("type") == "start"]
        if not start_nodes:
            await self._fail_run(run_id, "No start node defined")
            return run_id

        for sn in start_nodes:
            asyncio.create_task(self._execute_node(run_id, sn, context))

        return run_id

    async def cancel_run(self, run_id: str) -> bool:
        """取消运行：标记状态 + 停止所有 running 节点。"""
        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text("SELECT id, status FROM workflow_runs WHERE id = :id"),
                    {"id": run_id},
                )
            ).fetchone()
            if not row:
                return False
            current_status = dict(row._mapping)["status"]
            if current_status in ("completed", "failed", "cancelled"):
                return True

            await session.execute(
                text(
                    """
                    UPDATE workflow_runs
                    SET status = 'cancelled', completed_at = :now
                    WHERE id = :id
                    """
                ),
                {"id": run_id, "now": _now_iso()},
            )
            await session.execute(
                text(
                    """
                    UPDATE workflow_node_runs
                    SET status = 'cancelled', completed_at = :now
                    WHERE run_id = :run_id AND status IN ('pending', 'running', 'waiting_approval')
                    """
                ),
                {"run_id": run_id, "now": _now_iso()},
            )
            await session.commit()

        self._runs.pop(run_id, None)

        await ws_hub.broadcast(
            "workflows",
            {"type": "workflow.run.cancelled", "run_id": run_id},
        )
        return True

    # ── internals: dispatch ──────────────────────────────

    async def _execute_node(self, run_id: str, node: dict, context: dict):
        """执行单个节点。"""
        node_id = node["id"]
        node_type = node.get("type", "agent")

        try:
            await self._update_node_status(run_id, node_id, "running")
            await ws_hub.broadcast(
                "workflows",
                {
                    "type": "workflow.node.started",
                    "run_id": run_id,
                    "node_id": node_id,
                    "node_type": node_type,
                },
            )

            # 触发 workflow.node.pre Hook（异步非阻塞）
            self._fire_hook(
                "workflow.node.pre",
                run_id,
                node_id=node_id,
                node_type=node_type,
            )

            if node_type == "start":
                await self._update_node_status(run_id, node_id, "completed", output="")
                await self._execute_next_nodes(run_id, node_id, context)
                return

            if node_type in TERMINAL_NODE_TYPES:
                await self._update_node_status(run_id, node_id, "completed", output="")
                final_status = TERMINAL_RUN_STATUS.get(node_type, "completed")
                await self._complete_run(run_id, final_status=final_status)
                return

            if node_type == "agent":
                await self._execute_agent_node(run_id, node, context)
                return

            if node_type == "approval":
                # 等待外部回调
                await self._update_node_status(run_id, node_id, "waiting_approval")
                await event_emitter.emit_approval_requested(
                    task_id=run_id,  # 复用 task_events，这里用 run_id 作占位
                    workspace_id=self._get_workspace_id(run_id),
                    approval_id=f"{run_id}:{node_id}",
                    reason=node.get("data", {}).get("label", "Workflow approval"),
                )
                return

            if node_type == "condition":
                output = await self._execute_condition_node(run_id, node, context)
                await self._update_node_status(
                    run_id, node_id, "completed", output=output or ""
                )
                # 注意：condition 节点的 _execute_next_nodes 在 _execute_condition_node 内已选择性触发
                return

            if node_type == "parallel":
                await self._update_node_status(run_id, node_id, "completed", output="")
                await self._execute_next_nodes(run_id, node_id, context)
                return

            if node_type == "parallel_join":
                # 检查上游是否全部完成
                done = await self._check_all_upstream_complete(run_id, node_id)
                if done:
                    await self._update_node_status(
                        run_id, node_id, "completed", output=""
                    )
                    await self._execute_next_nodes(run_id, node_id, context)
                else:
                    # 等待，回滚到 pending（等其他分支完成时会重新触发）
                    await self._update_node_status(run_id, node_id, "pending")
                return

            if node_type == "delay":
                seconds = float(node.get("data", {}).get("seconds", 1))
                await asyncio.sleep(max(0.0, seconds))
                await self._update_node_status(
                    run_id, node_id, "completed", output=f"slept {seconds}s"
                )
                await self._execute_next_nodes(run_id, node_id, context)
                return

            if node_type == "stage":
                # stage 节点是工作项的停留阶段，在一次性自动化执行中直接跳过
                await self._update_node_status(
                    run_id, node_id, "completed", output="stage:skipped"
                )
                await self._execute_next_nodes(run_id, node_id, context)
                return

            if node_type == "git_merge":
                await self._execute_git_merge_node(run_id, node, context)
                return

            # 未知节点类型 — 直接跳过
            logger.warning("Unknown node type: %s for %s", node_type, node_id)
            await self._update_node_status(
                run_id, node_id, "completed", output=f"skipped:{node_type}"
            )
            await self._execute_next_nodes(run_id, node_id, context)

        except Exception as exc:
            logger.exception("Execute node failed: run=%s node=%s", run_id, node_id)
            await self._update_node_status(
                run_id, node_id, "failed", error=str(exc)
            )
            await self._handle_node_failure(run_id, node, str(exc))

    async def _execute_git_merge_node(self, run_id: str, node: dict, context: dict):
        """执行 Git Merge 节点：将源分支合入目标分支。"""
        node_id = node["id"]
        data = node.get("data", {})

        # 1. 从 node.data 提取配置（支持模板变量渲染）
        source_branch = self._render_template(data.get("sourceBranch", ""), context)
        target_branch = self._render_template(data.get("targetBranch", ""), context)
        strategy = data.get("mergeStrategy", "merge")       # merge | squash | rebase
        delete_source = data.get("deleteSource", False)
        on_conflict = data.get("onConflict", "fail")        # fail | abort | manual
        cwd = self._render_template(data.get("cwd", ""), context) or str(Path.cwd())

        # 2. 获取 repo root
        from backend.runtime.git_utils import git_repo_root, git_merge_branch, work_item_branch_name
        repo_root = await git_repo_root(Path(cwd))
        if repo_root is None:
            error = f"Not a git repository: {cwd}"
            await self._update_node_status(run_id, node_id, "failed", error=error)
            await self._handle_node_failure(run_id, node, error)
            return

        # 3. 校验 source_branch：若为空，尝试从 context 中获取工作项分支
        if not source_branch:
            wi_id = (context.get("start", {}).get("input", {}).get("work_item_id", "")
                     or context.get("work_item_id", ""))
            if wi_id:
                source_branch = work_item_branch_name(wi_id)
                logger.info(
                    "[workflow] git_merge node: using work item branch as source: %s",
                    source_branch,
                )

        if not source_branch:
            error = "sourceBranch is required but empty"
            await self._update_node_status(run_id, node_id, "failed", error=error)
            await self._handle_node_failure(run_id, node, error)
            return

        # 3.1 校验 target_branch：若为空，优先使用版本分支，其次工作项 worktree 分支
        if not target_branch:
            wi_id = (context.get("work_item_id", "")
                     or context.get("start", {}).get("input", {}).get("work_item_id", ""))
            if wi_id:
                # 优先使用版本分支
                version_branch = await self._resolve_version_branch_for_work_item(wi_id)
                if version_branch:
                    target_branch = version_branch
                    logger.info(
                        "[workflow] git_merge node: using version branch as target: %s",
                        target_branch,
                    )
                else:
                    target_branch = work_item_branch_name(wi_id)
                    logger.info(
                        "[workflow] git_merge node: using work item branch as target: %s",
                        target_branch,
                    )
            else:
                target_branch = "main"

        # 4. 执行合并
        success, output, conflicts = await git_merge_branch(
            repo_root=repo_root,
            source_branch=source_branch,
            target_branch=target_branch,
            strategy=strategy,
            delete_source=delete_source,
        )

        # 5. 处理结果
        if success:
            # 合并成功后，检查是否需要 auto push
            auto_push = data.get("autoPush", False)
            if auto_push:
                project_id = (
                    context.get("project_id", "")
                    or context.get("start", {}).get("input", {}).get("project_id", "")
                )
                if project_id:
                    from backend.services.work_item_service import work_item_service
                    git_config = await work_item_service.get_project_git_config(project_id)
                    repo_url = git_config.get("repo_url", "")
                    if repo_url:
                        from backend.runtime.git_utils import git_ensure_remote, git_push
                        remote_ok = await git_ensure_remote(repo_root, repo_url)
                        if remote_ok:
                            push_ok, push_output = await git_push(
                                repo_root, target_branch, git_config=git_config
                            )
                            if not push_ok:
                                logger.warning(
                                    "[workflow] auto push failed for %s: %s",
                                    target_branch, push_output,
                                )
                            else:
                                logger.info(
                                    "[workflow] auto push success: branch=%s", target_branch,
                                )
                        else:
                            logger.warning(
                                "[workflow] failed to ensure remote for %s", repo_url,
                            )

            result = json.dumps({
                "merged": True,
                "source": source_branch,
                "target": target_branch,
                "strategy": strategy,
                "output": output,
            })
            await self._update_node_status(run_id, node_id, "completed", output=result)
            ctx = await self._update_run_context(run_id, node_id, {"output": result})
            await self._execute_next_nodes(run_id, node_id, ctx)
        else:
            # 冲突处理
            error_detail = f"Merge failed: {output}"
            if conflicts:
                error_detail += f" | Conflicts: {', '.join(conflicts)}"

            if on_conflict == "manual":
                # 类似 approval 节点，暂停等待人工处理
                await self._update_node_status(run_id, node_id, "waiting_approval")
                # 存储冲突信息到 context，供 API 查询
                await self._update_run_context(run_id, node_id, {
                    "merge_conflict": True,
                    "conflicts": conflicts,
                    "source": source_branch,
                    "target": target_branch,
                    "error": output,
                })
                # 发送 WebSocket 通知
                try:
                    await event_emitter.emit("merge_conflict", {
                        "run_id": run_id,
                        "node_id": node_id,
                        "conflicts": conflicts,
                        "source": source_branch,
                        "target": target_branch,
                    })
                except Exception:
                    pass
            else:
                # fail 或 abort：直接标记失败
                await self._update_node_status(run_id, node_id, "failed", error=error_detail)
                await self._handle_node_failure(run_id, node, error_detail)

    async def _resolve_version_branch_for_work_item(self, work_item_id: str) -> str:
        """根据工作项 ID 查询关联版本，返回版本分支名。"""
        async with async_session_factory() as session:
            row = await session.execute(
                text("""
                    SELECT v.name FROM work_items wi
                    JOIN versions v ON v.id = wi.version_id
                    WHERE wi.id = :wi_id AND wi.version_id IS NOT NULL
                """),
                {"wi_id": work_item_id}
            )
            result = row.fetchone()
        if not result or not result[0]:
            return ""
        from backend.runtime.git_utils import version_branch_name
        return version_branch_name(result[0])

    async def _execute_agent_node(self, run_id: str, node: dict, context: dict):
        """Agent 节点：创建 task 记录 + 真实 Agent CLI 执行 + 完成回调。

        当 ``agentId`` 以 ``a2a:`` 开头时，路由到远程 A2A Agent，跳过本地 CLI
        的可用性检查与 full_auto/沙箱配置；上游节点输出会以上下文块的形式自动
        附加到 prompt（仅当模板未显式引用上游节点时），以便远程 Agent 通过
        A2AAdapter 的 ``_build_context_parts`` 拿到关联上下文。
        """
        node_id = node["id"]
        data = node.get("data", {})
        agent_id = data.get("agentId") or data.get("agent_id") or "codex"
        model = data.get("model") or None
        prompt_template = data.get("promptTemplate") or data.get("prompt") or ""
        prompt = self._render_template(prompt_template, context)
        cwd = data.get("cwd") or str(Path.cwd())

        run_info = self._runs.get(run_id) or {}
        workspace_id = run_info.get("workspace_id") or self._get_workspace_id(run_id)

        # 专家团解析：若节点配置了 expert_team_id，覆盖 agent_id、合并 skills、注入角色提示词
        if data.get("expert_team_id"):
            try:
                from backend.services.expert_team_service import ExpertTeamService
                expert_team_svc = ExpertTeamService()
                expert_team = await expert_team_svc.resolve_squad(
                    data["expert_team_id"], workspace_id
                )
                if expert_team:
                    # 覆盖 Agent
                    agent_id = expert_team["agent_id"]
                    # 覆盖模型（如果专家团配置了自定义模型）
                    if expert_team.get("model"):
                        model = expert_team["model"]
                    # 合并 Skills（专家团技能 + 节点手动选择的技能）
                    existing_skills = data.get("skills", []) or []
                    combined_skills = expert_team.get("skill_slugs", []) + existing_skills
                    data["skills"] = list(dict.fromkeys(combined_skills))  # 去重保序
                    # 注入角色提示词
                    if expert_team.get("role_prompt"):
                        prompt = f"# 你的角色\n\n{expert_team['role_prompt']}\n\n---\n\n{prompt}"
            except Exception as e:
                logger.warning("Expert team resolution failed: %s", e)

        # Rules 注入（强制约束）：在 Skills 之前注入，作为 prompt 顶部前缀。
        # 异常静默回退，不阻塞主流程。
        project_id = (
            context.get("project_id", "")
            or context.get("start", {}).get("input", {}).get("project_id", "")
        ) or None
        try:
            prompt = await _build_prompt_with_rules(
                prompt, workspace_id, cwd, project_id
            )
        except Exception as e:
            logger.warning("Rules injection failed: %s", e)

        # Knowledge 注入：项目知识库模块摘要，作为项目结构参考。
        # 知识库不存在或加载失败时静默回退，不阻塞主流程。
        try:
            prompt = await _build_prompt_with_knowledge(prompt, cwd=cwd, project_id=project_id)
        except Exception as e:
            logger.warning("[workflow] inject knowledge failed run=%s node=%s: %s", run_id, node_id, e)

        # Skills 注入：读取 node.data.skills（slug 列表）并将 Skill 内容作为
        # prompt 前缀拼接。支持 list[str] 或逗号分隔的字符串。
        skills_field = data.get("skills") or []
        if isinstance(skills_field, str):
            skill_slugs = [s.strip() for s in skills_field.split(",") if s.strip()]
        elif isinstance(skills_field, list):
            skill_slugs = [str(s).strip() for s in skills_field if str(s).strip()]
        else:
            skill_slugs = []
        if skill_slugs:
            try:
                prompt = await _build_prompt_with_skills(
                    prompt, skill_slugs, workspace_id=workspace_id
                )
            except Exception:
                logger.exception(
                    "[workflow] inject skills failed run=%s node=%s slugs=%s",
                    run_id, node_id, skill_slugs,
                )

        # 远程 A2A Agent：若 prompt 模板未引用上游节点，自动附加上游输出
        if agent_id.startswith("a2a:"):
            upstream_outputs = self._collect_upstream_outputs(run_id, node_id, context)
            referenced = any(uid in (prompt_template or "") for uid, _ in upstream_outputs)
            if upstream_outputs and not referenced:
                ctx_block = "\n\n".join(
                    f"### 来自上游节点 `{uid}` 的输出\n{out}"
                    for uid, out in upstream_outputs
                )
                prompt = f"{prompt}\n\n## 上游节点上下文\n{ctx_block}".strip()

        # 创建 task 记录（绑定 workflow_run_id / workflow_node_id）
        task_id = str(uuid.uuid4())
        now = _now_iso()

        # 推断 DB 中记录的实际模型名：通过 adapter.normalize_model 校验后，
        # 若为空或等于 agent_id 则回退到对应 CLI 的环境变量默认模型。
        # 注意：仅影响 DB 存储，不改动传给 _real_agent_execution 的 model 参数。
        db_model = model
        if not agent_id.startswith("a2a:"):
            _adapter = AGENT_ADAPTERS.get(agent_id)
            if _adapter:
                _normalized = _adapter.normalize_model(model or "")
                db_model = _normalized
                if not db_model or db_model == agent_id:
                    db_model = _adapter.default_model or agent_id

        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO tasks
                        (id, workspace_id, workflow_run_id, workflow_node_id,
                         prompt, agent_id, model, cwd, status, created_at, started_at)
                    VALUES (:id, :workspace_id, :run_id, :node_id,
                            :prompt, :agent_id, :model, :cwd, 'running', :created_at, :started_at)
                    """
                ),
                {
                    "id": task_id,
                    "workspace_id": workspace_id,
                    "run_id": run_id,
                    "node_id": node_id,
                    "prompt": prompt,
                    "agent_id": agent_id,
                    "model": db_model or None,
                    "cwd": cwd,
                    "created_at": now,
                    "started_at": now,
                },
            )
            # 关联 task_id 到 node_run
            await session.execute(
                text(
                    """
                    UPDATE workflow_node_runs
                    SET task_id = :task_id
                    WHERE run_id = :run_id AND node_id = :node_id
                    """
                ),
                {"task_id": task_id, "run_id": run_id, "node_id": node_id},
            )
            await session.commit()

        await event_emitter.emit_task_created(task_id, workspace_id)

        # 真实 Agent CLI 执行（fire-and-forget），完成后调用 on_task_completed / on_task_failed
        asyncio.create_task(
            self._real_agent_execution(
                task_id, run_id, node_id, agent_id, prompt, cwd, model
            )
        )

    async def _real_agent_execution(
        self,
        task_id: str,
        run_id: str,
        node_id: str,
        agent_id: str,
        prompt: str,
        cwd: str,
        model: str = "",
    ):
        """真实 Agent CLI 执行（替代模拟）。

        - 本地 Agent：检查适配器与 CLI binary 是否可用；full_auto 执行；
        - 远程 A2A Agent（``a2a:`` 前缀）：跳过本地 CLI 检查与 full_auto/沙箱配置，
          由 ``executor.run_task`` 内部路由到远程执行；
        - 完成后更新 tasks 表并通知 DAG 引擎推进。
        """
        is_remote = agent_id.startswith("a2a:")

        # 本地 Agent：检查 Agent CLI 是否可用，缺少则显式失败
        if not is_remote:
            adapter = AGENT_ADAPTERS.get(agent_id)
            if adapter is None:
                msg = (
                    f"Unsupported agent_id: {agent_id!r}. "
                    f"Available agents: {', '.join(sorted(AGENT_ADAPTERS))}"
                )
                await self._finalize_task(task_id, "failed", msg)
                await self.on_task_failed(task_id, msg)
                return
            if not adapter.bin_name or shutil.which(adapter.bin_name) is None:
                msg = (
                    f"Agent CLI '{adapter.bin_name}' not found in PATH. "
                    "Install it or use a different agent."
                )
                await self._finalize_task(task_id, "failed", msg)
                await self.on_task_failed(task_id, msg)
                return

        output_parts: list[str] = []
        agent_final_output: str = ""  # 仅存 completed 事件的精炼摘要
        final_status = "completed"
        try:
            async for event in agent_executor.run_task(
                task_id=task_id,
                agent_id=agent_id,
                prompt=prompt,
                cwd=cwd,
                model=model,
                full_auto=not is_remote,
            ):
                if event.type in ("output", "tool_output", "progress"):
                    if event.content:
                        output_parts.append(event.content)
                elif event.type == "completed":
                    if event.content:
                        output_parts.append(event.content)
                        agent_final_output = event.content
                    final_status = "completed"
                elif event.type == "failed":
                    if event.content:
                        output_parts.append(event.content)
                    final_status = "failed"
                elif event.type == "cancelled":
                    final_status = "cancelled"
                elif event.type == "approval_request":
                    # full_auto 模式下理论不会触发，仅作 fallback
                    logger.warning(
                        "Unexpected approval_request in workflow (full_auto): %s",
                        event.content,
                    )
                    if event.content:
                        output_parts.append(event.content)
                    # 不再设 final_status = "failed"，继续执行
        except asyncio.CancelledError:
            await agent_executor.cancel_task(task_id)
            final_status = "cancelled"
            raise
        except Exception as exc:
            logger.exception("Real agent execution failed: %s", task_id)
            final_status = "failed"
            output_parts.append(f"Error: {exc}")

        final_output = "\n".join(p for p in output_parts if p)
        db_status = "stopped" if final_status == "cancelled" else final_status
        await self._finalize_task(task_id, db_status, final_output, agent_final_output)

        if final_status == "completed":
            await self.on_task_completed(task_id, final_output, agent_final_output)
        else:
            await self.on_task_failed(task_id, final_output or final_status)

    async def _finalize_task(self, task_id: str, status: str, output: str, agent_final_output: str = ""):
        """更新 tasks 表的最终状态/结果。"""
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    UPDATE tasks
                    SET status = :status, completed_at = :now, result = :result,
                        agent_final_output = :agent_final_output
                    WHERE id = :id
                    """
                ),
                {
                    "id": task_id,
                    "now": _now_iso(),
                    "status": status,
                    "result": output,
                    "agent_final_output": agent_final_output or None,
                },
            )
            await session.commit()

    async def _execute_condition_node(
        self, run_id: str, node: dict, context: dict
    ) -> Optional[str]:
        """评估条件，沿匹配的 edge 触发下游。"""
        node_id = node["id"]
        data = node.get("data", {}) or {}
        conditions = data.get("conditions") or []
        run_info = await self._ensure_run_loaded(run_id) or {}
        edges = run_info.get("definition", {}).get("edges", [])
        nodes = run_info.get("definition", {}).get("nodes", [])
        outgoing = [e for e in edges if e.get("source") == node_id]

        chosen_edge = None

        if conditions:
            # 多条件数组模式：根据 conditions[i].targetEdge 匹配出边
            target_edge_id = await self._evaluate_condition(conditions, context)
            if target_edge_id:
                chosen_edge = next(
                    (e for e in edges if e.get("id") == target_edge_id), None
                )
        else:
            # 单条件扁平字段模式（前端 PropertyPanel 保存格式）：
            # data: { field, operator, value }
            field = data.get("field", "")
            if field:
                op = data.get("operator", "eq")
                expected = data.get("value")
                actual = self._resolve_path(field, context)
                matched = self._compare(actual, op, expected)
                # 条件 TRUE → sourceHandle == 'yes'；FALSE → sourceHandle == 'no'
                handle = "yes" if matched else "no"
                logger.info(
                    "[Condition] node=%s field=%s op=%s actual=%r expected=%r matched=%s handle=%s",
                    node_id, field, op, actual, expected, matched, handle,
                )
                chosen_edge = next(
                    (e for e in outgoing if e.get("sourceHandle") == handle),
                    None,
                )

        # 如果没有匹配，使用 default 边（label == 'default' / 'no' / '否' / 'else' 或 isDefault，或 sourceHandle == 'no'）
        if not chosen_edge:
            chosen_edge = next(
                (
                    e for e in outgoing
                    if e.get("data", {}).get("isDefault")
                    or (e.get("label") or "").lower() in ("default", "no", "否", "else")
                ),
                None,
            )
            if not chosen_edge:
                chosen_edge = next(
                    (e for e in outgoing if e.get("sourceHandle") == "no"),
                    None,
                )
            if not chosen_edge:
                # 没有匹配且没有 default 边：标记节点失败，按 onFailure 策略处理
                logger.warning(
                    "Condition node %s: no condition matched and no default edge found",
                    node_id,
                )
                await self._update_node_status(
                    run_id, node_id, "failed", error="No condition matched"
                )
                await self._handle_node_failure(run_id, node, "No condition matched")
                return "no-match"

        if not chosen_edge:
            return "no-edge-matched"

        target_node = next((n for n in nodes if n["id"] == chosen_edge["target"]), None)
        if target_node:
            asyncio.create_task(self._execute_node(run_id, target_node, context))
        return f"chose:{chosen_edge.get('id')}"

    # ── routing ──────────────────────────────────────────

    async def _execute_next_nodes(
        self, run_id: str, completed_node_id: str, context: dict
    ):
        run_info = await self._ensure_run_loaded(run_id)
        if not run_info:
            return
        edges = run_info["definition"]["edges"]
        nodes = run_info["definition"]["nodes"]

        outgoing = [e for e in edges if e.get("source") == completed_node_id]
        for edge in outgoing:
            target_id = edge.get("target")
            target_node = next((n for n in nodes if n["id"] == target_id), None)
            if not target_node:
                continue

            if target_node.get("type") == "parallel_join":
                done = await self._check_all_upstream_complete(run_id, target_id)
                if not done:
                    continue

            asyncio.create_task(self._execute_node(run_id, target_node, context))

    # ── callbacks ────────────────────────────────────────

    async def on_task_completed(self, task_id: str, result: str, agent_final_output: str = ""):
        """Agent 任务完成回调。"""
        link = await self._find_node_run_by_task(task_id)
        if not link:
            return
        run_id, node_id = link

        # 服务重启后内存缓存可能 miss，从 DB 重建
        if not await self._ensure_run_loaded(run_id):
            logger.error("on_task_completed: run %s not found in cache or DB", run_id)
            return

        await self._update_node_status(run_id, node_id, "completed", output=result)
        await ws_hub.broadcast(
            "workflows",
            {
                "type": "workflow.node.completed",
                "run_id": run_id,
                "node_id": node_id,
                "task_id": task_id,
            },
        )

        # 存储到 context：output 为完整日志（调试用），agent_final_output 为精炼摘要（供下游引用）
        ctx_data: dict = {"output": result}
        # 始终保存 agent_final_output，确保下游节点能正确获取
        ctx_data["agent_final_output"] = agent_final_output or ""
        context = await self._update_run_context(run_id, node_id, ctx_data)
        await self._execute_next_nodes(run_id, node_id, context)

    async def on_task_failed(self, task_id: str, error: str):
        link = await self._find_node_run_by_task(task_id)
        if not link:
            return
        run_id, node_id = link
        await self._update_node_status(run_id, node_id, "failed", error=error)

        # 查询节点配置，应用 onFailure 策略（从 DB 恢复以应对服务重启）
        run_info = await self._ensure_run_loaded(run_id) or {}
        nodes = run_info.get("definition", {}).get("nodes", [])
        node = next((n for n in nodes if n["id"] == node_id), None)
        await self._handle_node_failure(run_id, node, error)

    async def on_approval_resolved(
        self, run_id: str, node_id: str, approved: bool, reason: str = ""
    ):
        # 服务重启后内存缓存可能 miss，从 DB 重建
        run_info = await self._ensure_run_loaded(run_id)
        if not run_info:
            logger.error("on_approval_resolved: run %s not found in cache or DB", run_id)
            return

        if approved:
            await self._update_node_status(
                run_id, node_id, "completed", output="approved"
            )
            context = await self._update_run_context(
                run_id, node_id, {"output": "approved", "reason": reason}
            )
            await self._execute_next_nodes(run_id, node_id, context)
            return

        # 拒绝时：审批节点视为正常完成（拒绝是业务正常流），
        # 写入 output="rejected" 到 context，让下游 Condition 节点可以判断走向。
        await self._update_node_status(
            run_id, node_id, "completed", output="rejected"
        )
        context = await self._update_run_context(
            run_id, node_id, {"output": "rejected", "reason": reason}
        )
        logger.info(
            "[Approval] run=%s node=%s rejected, context after update: %s",
            run_id, node_id, context.get(node_id),
        )
        nodes = run_info.get("definition", {}).get("nodes", [])
        node = next((n for n in nodes if n["id"] == node_id), None)
        # 审批节点的 onFailure 默认 "abort"：拒绝后停止执行下游分支
        on_failure = (
            node.get("data", {}).get("onFailure", "abort") if node else "abort"
        )
        if on_failure == "continue":
            await self._execute_next_nodes(run_id, node_id, context)
        else:
            await self._fail_run(run_id, reason or "rejected")

    async def on_merge_resolved(
        self, run_id: str, node_id: str, resolved: bool, message: str = ""
    ):
        """Git merge 冲突手工解决后的回调。

        Args:
            run_id: 工作流运行 ID
            node_id: git_merge 节点 ID
            resolved: 是否已解决（True=合并完成，False=放弃合并）
            message: 可选的备注信息
        """
        # 服务重启后内存缓存可能 miss，从 DB 重建
        if not await self._ensure_run_loaded(run_id):
            logger.error("on_merge_resolved: run %s not found in cache or DB", run_id)
            return

        if resolved:
            result = json.dumps({
                "merged": True,
                "resolved_manually": True,
                "message": message,
            })
            await self._update_node_status(run_id, node_id, "completed", output=result)
            context = await self._update_run_context(run_id, node_id, {"output": result})
            await self._execute_next_nodes(run_id, node_id, context)
        else:
            error = f"Merge aborted manually: {message}" if message else "Merge aborted manually"
            await self._update_node_status(run_id, node_id, "failed", error=error)
            # 获取节点信息触发失败处理
            run_info = self._runs.get(run_id) or {}
            nodes = run_info.get("definition", {}).get("nodes", [])
            node = next((n for n in nodes if n["id"] == node_id), None)
            if node:
                await self._handle_node_failure(run_id, node, error)

    # ── helpers: persistence ─────────────────────────────

    async def _ensure_run_loaded(self, run_id: str) -> Optional[dict]:
        """确保 run 在内存缓存中。缓存 miss 时从 DB 重建。

        服务重启后，``self._runs`` 是空的；当外部回调（审批、任务完成、合并解决等）
        到达时，需要从 ``workflow_runs`` + ``workflows`` 表恢复运行上下文，
        否则所有等待中的工作流都会断裂。

        Returns:
            缓存中的 run_data（包含 id/workflow_id/workspace_id/status/definition/context）；
            run 不存在时返回 None。即使状态为 completed/failed 也会返回，由调用方判断。
        """
        cached = self._runs.get(run_id)
        if cached:
            return cached

        async with async_session_factory() as session:
            run_row = (
                await session.execute(
                    text(
                        """
                        SELECT id, workflow_id, workspace_id, status, context
                        FROM workflow_runs WHERE id = :id
                        """
                    ),
                    {"id": run_id},
                )
            ).fetchone()
            if not run_row:
                return None
            run_m = dict(run_row._mapping)

            wf_row = (
                await session.execute(
                    text("SELECT definition FROM workflows WHERE id = :id"),
                    {"id": run_m["workflow_id"]},
                )
            ).fetchone()

        if not wf_row:
            logger.error(
                "_ensure_run_loaded: workflow %s referenced by run %s not found",
                run_m["workflow_id"], run_id,
            )
            return None

        definition = _safe_json_loads(
            dict(wf_row._mapping).get("definition"), {"nodes": [], "edges": []}
        )
        context = _safe_json_loads(run_m.get("context"), {})

        run_data = {
            "id": run_m["id"],
            "workflow_id": run_m["workflow_id"],
            "workspace_id": run_m["workspace_id"],
            "status": run_m["status"],
            "definition": definition,
            "context": context,
        }
        self._runs[run_id] = run_data
        logger.info("_ensure_run_loaded: restored run %s from DB (status=%s)", run_id, run_m["status"])
        return run_data

    async def _update_node_status(
        self,
        run_id: str,
        node_id: str,
        status: str,
        output: Optional[str] = None,
        error: Optional[str] = None,
    ):
        sets = ["status = :status"]
        params: dict = {"status": status, "run_id": run_id, "node_id": node_id}

        if status == "running":
            sets.append("started_at = :started_at")
            params["started_at"] = _now_iso()
        if status in ("completed", "failed", "cancelled"):
            sets.append("completed_at = :completed_at")
            params["completed_at"] = _now_iso()
        if output is not None:
            sets.append("output = :output")
            params["output"] = output
        if error is not None:
            sets.append("error = :error")
            params["error"] = error

        async with async_session_factory() as session:
            await session.execute(
                text(
                    f"""
                    UPDATE workflow_node_runs
                    SET {', '.join(sets)}
                    WHERE run_id = :run_id AND node_id = :node_id
                    """
                ),
                params,
            )
            await session.commit()

        # 节点进入“完成”状态时触发 workflow.node.post Hook
        if status == "completed":
            node_type = self._lookup_node_type(run_id, node_id)
            self._fire_hook(
                "workflow.node.post",
                run_id,
                node_id=node_id,
                node_type=node_type,
            )

    async def _update_run_context(
        self, run_id: str, node_id: str, node_data: dict
    ) -> dict:
        """合并节点输出到 context["<node_id>"]，并持久化。返回最新 context。

        关键：写入 DB 后必须同步更新 ``self._runs[run_id]["context"]`` 内存缓存，
        否则后续从缓存读取 context 的代码路径（如 ``_handle_node_failure``、
        ``_collect_upstream_outputs``）会拿到旧值，导致条件分支等场景误判。
        """
        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text("SELECT context FROM workflow_runs WHERE id = :id"),
                    {"id": run_id},
                )
            ).fetchone()
            ctx = _safe_json_loads(row._mapping["context"] if row else None, {})
            ctx[node_id] = {**(ctx.get(node_id) or {}), **node_data}
            await session.execute(
                text(
                    "UPDATE workflow_runs SET context = :ctx WHERE id = :id"
                ),
                {"id": run_id, "ctx": json.dumps(ctx)},
            )
            await session.commit()

        # 同步更新内存缓存，保证 self._runs[run_id]["context"] 与 DB 一致
        if run_id in self._runs:
            self._runs[run_id]["context"] = ctx
        return ctx

    async def _complete_run(self, run_id: str, final_status: str = "completed"):
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    UPDATE workflow_runs
                    SET status = :final_status, completed_at = :now
                    WHERE id = :id
                    """
                ),
                {"id": run_id, "final_status": final_status, "now": _now_iso()},
            )
            # 未触发的分支节点标记为 skipped
            await session.execute(
                text(
                    """
                    UPDATE workflow_node_runs
                    SET status = 'skipped', completed_at = :now
                    WHERE run_id = :id AND status = 'pending'
                    """
                ),
                {"id": run_id, "now": _now_iso()},
            )
            await session.commit()
        self._runs.pop(run_id, None)
        event_type = f"workflow.run.{final_status}"
        await ws_hub.broadcast(
            "workflows",
            {"type": event_type, "run_id": run_id},
        )

        # 触发 Hook（异步非阻塞）
        self._fire_hook(event_type, run_id)

    async def _fail_run(self, run_id: str, error: str):
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    UPDATE workflow_runs
                    SET status = 'failed', completed_at = :now
                    WHERE id = :id
                    """
                ),
                {"id": run_id, "now": _now_iso()},
            )
            await session.commit()
        self._runs.pop(run_id, None)
        await ws_hub.broadcast(
            "workflows",
            {"type": "workflow.run.failed", "run_id": run_id, "error": error},
        )

    async def _handle_node_failure(self, run_id: str, node: Optional[dict], error: str):
        """根据 onFailure 策略处理：abort（默认） / continue / retry。"""
        on_failure = "abort"
        if node:
            on_failure = node.get("data", {}).get("onFailure", "abort")

        if on_failure == "continue":
            run_info = await self._ensure_run_loaded(run_id) or {}
            await self._execute_next_nodes(run_id, node["id"] if node else "", run_info.get("context", {}))
            return

        await self._fail_run(run_id, error)

    async def _find_node_run_by_task(self, task_id: str) -> Optional[tuple[str, str]]:
        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text(
                        """
                        SELECT run_id, node_id FROM workflow_node_runs
                        WHERE task_id = :task_id
                        """
                    ),
                    {"task_id": task_id},
                )
            ).fetchone()
        if not row:
            return None
        m = dict(row._mapping)
        return m["run_id"], m["node_id"]

    async def _check_all_upstream_complete(
        self, run_id: str, node_id: str
    ) -> bool:
        """检查 parallel_join 的所有上游节点是否全部 completed。"""
        run_info = await self._ensure_run_loaded(run_id) or {}
        edges = run_info.get("definition", {}).get("edges", [])
        upstream_ids = [e["source"] for e in edges if e.get("target") == node_id]
        if not upstream_ids:
            return True

        async with async_session_factory() as session:
            placeholders = ",".join([f":n{i}" for i in range(len(upstream_ids))])
            params = {"run_id": run_id}
            for i, uid in enumerate(upstream_ids):
                params[f"n{i}"] = uid
            result = await session.execute(
                text(
                    f"""
                    SELECT node_id, status FROM workflow_node_runs
                    WHERE run_id = :run_id AND node_id IN ({placeholders})
                    """
                ),
                params,
            )
            rows = result.fetchall()
        statuses = {dict(r._mapping)["node_id"]: dict(r._mapping)["status"] for r in rows}
        return all(statuses.get(uid) == "completed" for uid in upstream_ids)

    def _get_workspace_id(self, run_id: str) -> str:
        return (self._runs.get(run_id) or {}).get("workspace_id") or "default"

    def _lookup_node_type(self, run_id: str, node_id: str) -> Optional[str]:
        run_info = self._runs.get(run_id) or {}
        nodes = run_info.get("definition", {}).get("nodes", [])
        for n in nodes:
            if n.get("id") == node_id:
                return n.get("type")
        return None

    def _fire_hook(
        self,
        event: str,
        run_id: str,
        node_id: Optional[str] = None,
        node_type: Optional[str] = None,
        extra: Optional[dict] = None,
    ) -> None:
        """异步触发工作流 Hook，失败不阻塞主流程。"""
        try:
            workspace_id = self._get_workspace_id(run_id)
            payload: dict = {
                "event": event,
                "run_id": run_id,
                "workspace_id": workspace_id,
            }
            if node_id is not None:
                payload["node_id"] = node_id
            if node_type is not None:
                payload["node_type"] = node_type
            if extra:
                payload.update(extra)
            # 从运行上下文中提取 project_id
            run_ctx = (self._runs.get(run_id) or {}).get("context") or {}
            _project_id = (
                run_ctx.get("project_id", "")
                or run_ctx.get("start", {}).get("input", {}).get("project_id", "")
            ) or None
            asyncio.create_task(hook_engine.trigger(event, workspace_id, payload, project_id=_project_id))
        except Exception:
            logger.debug("workflow hook trigger dispatch failed", exc_info=True)

    def _collect_upstream_outputs(
        self, run_id: str, node_id: str, context: dict
    ) -> list[tuple[str, str]]:
        """返回当前节点的上游节点输出列表，形式为 [(node_id, output_text), ...]。

        仅返回上游在 ``context`` 中已设置 ``output`` 且为非空的节点。
        用于远程 A2A Agent 调用前自动注入上下文。
        """
        run_info = self._runs.get(run_id) or {}
        edges = run_info.get("definition", {}).get("edges", [])
        upstream_ids = [e["source"] for e in edges if e.get("target") == node_id]
        outputs: list[tuple[str, str]] = []
        for uid in upstream_ids:
            node_ctx = context.get(uid) if isinstance(context, dict) else None
            if not isinstance(node_ctx, dict):
                continue
            out = node_ctx.get("output")
            if out is None or out == "":
                continue
            if isinstance(out, (dict, list)):
                out_text = json.dumps(out, ensure_ascii=False)
            else:
                out_text = str(out)
            outputs.append((uid, out_text))
        return outputs

    # ── DAG validation ───────────────────────────────────

    def _validate_dag(self, nodes: list, edges: list) -> bool:
        """循环检测 + 必要节点校验。"""
        if not nodes:
            raise ValueError("Workflow must have at least one node")

        node_ids = {n["id"] for n in nodes}
        starts = [n for n in nodes if n.get("type") == "start"]
        ends = [n for n in nodes if n.get("type") in TERMINAL_NODE_TYPES]
        if not starts:
            raise ValueError("Workflow must have a start node")
        if not ends:
            raise ValueError("Workflow must have at least one terminal node (end, cancel, error, or close)")

        for e in edges:
            if e.get("source") not in node_ids or e.get("target") not in node_ids:
                raise ValueError(
                    f"Edge {e.get('id')} references unknown node"
                )

        # start 无入边
        for s in starts:
            if any(e.get("target") == s["id"] for e in edges):
                raise ValueError(f"Start node {s['id']} must have no incoming edges")
        # end 无出边
        for e_node in ends:
            if any(e.get("source") == e_node["id"] for e in edges):
                raise ValueError(f"Terminal node {e_node['id']} must have no outgoing edges")

        # 拓扑排序（Kahn）检测循环
        in_degree = {n["id"]: 0 for n in nodes}
        adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
        for e in edges:
            adj[e["source"]].append(e["target"])
            in_degree[e["target"]] += 1

        queue = deque([nid for nid, d in in_degree.items() if d == 0])
        visited = 0
        while queue:
            nid = queue.popleft()
            visited += 1
            for nxt in adj[nid]:
                in_degree[nxt] -= 1
                if in_degree[nxt] == 0:
                    queue.append(nxt)

        if visited != len(nodes):
            raise ValueError("Workflow contains cycles")
        return True

    # ── template & condition ─────────────────────────────

    def _render_template(self, template: str, context: dict) -> str:
        """渲染模板占位符。

        支持两种语法：
        - 双花括号：{{path.to.value}}
        - 单花括号：{path.to.value}（仅匹配合法标识符点路径，避免与 JSON/代码冲突）
        """
        if not template:
            return ""

        def resolve(path: str) -> str:
            path = (path or "").strip()
            # 容忍 "context.xxx" 前缀
            if path.startswith("context."):
                path = path[len("context."):]
            obj = context
            for part in path.split("."):
                if isinstance(obj, dict):
                    obj = obj.get(part, "")
                else:
                    return ""
            if obj is None:
                return ""
            if isinstance(obj, (dict, list)):
                return json.dumps(obj, ensure_ascii=False)
            return str(obj)

        rendered = re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", lambda m: resolve(m.group(1)), template)
        rendered = re.sub(
            r"\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}",
            lambda m: resolve(m.group(1)),
            rendered,
        )
        return rendered

    def _resolve_path(self, path: str, context: dict):
        if path.startswith("context."):
            path = path[len("context."):]
        obj = context
        for part in path.split("."):
            if isinstance(obj, dict):
                obj = obj.get(part)
            else:
                return None
            if obj is None:
                return None
        return obj

    async def _evaluate_condition(
        self, conditions: list, context: dict
    ) -> Optional[str]:
        """返回首个匹配条件的 targetEdge ID。"""
        for cond in conditions or []:
            field = cond.get("field", "")
            op = cond.get("operator", "eq")
            expected = cond.get("value")
            actual = self._resolve_path(field, context)
            if self._compare(actual, op, expected):
                return cond.get("targetEdge")
        return None

    @staticmethod
    def _compare(actual, op: str, expected) -> bool:
        try:
            if op == "eq":
                return str(actual) == str(expected)
            if op == "neq":
                return str(actual) != str(expected)
            if op == "contains":
                return str(expected) in (str(actual) if actual is not None else "")
            if op == "gt":
                return float(actual) > float(expected)
            if op == "lt":
                return float(actual) < float(expected)
        except (TypeError, ValueError):
            return False
        return False


workflow_engine = WorkflowEngine()
