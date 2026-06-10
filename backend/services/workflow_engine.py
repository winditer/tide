"""
WorkflowEngine — DAG 工作流执行引擎。

支持节点类型：
- start: 开始节点
- end: 结束节点
- agent: Agent 执行（真实 CLI：通过 AgentExecutor 流式执行，完成后调用 on_task_completed）
- approval: 人工审批（等待 on_approval_resolved 回调）
- condition: 条件分支（评估表达式选择边）
- parallel: 并行网关（fork，所有下游并行执行）
- parallel_join: 并行汇聚（等所有上游完成）
- delay: 延时节点（asyncio.sleep）

主要回调：
- on_task_completed / on_task_failed
- on_approval_resolved
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
from backend.runtime.adapters import AGENT_ADAPTERS
from backend.runtime.executor import agent_executor
from backend.services.event_emitter import event_emitter
from backend.services.ws_hub import ws_hub

logger = logging.getLogger("tide.workflow_engine")


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
            "workflow_id": workflow_id,
            "workspace_id": wf["workspace_id"],
            "definition": {"nodes": nodes, "edges": edges},
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

            if node_type == "start":
                await self._update_node_status(run_id, node_id, "completed", output="")
                await self._execute_next_nodes(run_id, node_id, context)
                return

            if node_type == "end":
                await self._update_node_status(run_id, node_id, "completed", output="")
                await self._complete_run(run_id)
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

    async def _execute_agent_node(self, run_id: str, node: dict, context: dict):
        """Agent 节点：创建 task 记录 + 真实 Agent CLI 执行 + 完成回调。"""
        node_id = node["id"]
        data = node.get("data", {})
        agent_id = data.get("agentId") or data.get("agent_id") or "codex"
        model = data.get("model") or ""
        prompt_template = data.get("promptTemplate") or data.get("prompt") or ""
        prompt = self._render_template(prompt_template, context)
        cwd = data.get("cwd") or str(Path.cwd())

        run_info = self._runs.get(run_id) or {}
        workspace_id = run_info.get("workspace_id") or self._get_workspace_id(run_id)

        # 创建 task 记录（绑定 workflow_run_id / workflow_node_id）
        task_id = str(uuid.uuid4())
        now = _now_iso()
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
                    "model": model or None,
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

        - 通过 AgentExecutor 流式执行 Agent CLI；
        - 若 CLI 不可用，标记任务失败而非伪造成功；
        - 完成后更新 tasks 表并通知 DAG 引擎推进。
        """
        # 检查 Agent CLI 是否可用，缺少则显式失败
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
        final_status = "completed"
        try:
            async for event in agent_executor.run_task(
                task_id=task_id,
                agent_id=agent_id,
                prompt=prompt,
                cwd=cwd,
                model=model,
            ):
                if event.type in ("output", "tool_output", "progress"):
                    if event.content:
                        output_parts.append(event.content)
                elif event.type == "completed":
                    if event.content:
                        output_parts.append(event.content)
                    final_status = "completed"
                elif event.type == "failed":
                    if event.content:
                        output_parts.append(event.content)
                    final_status = "failed"
                elif event.type == "cancelled":
                    final_status = "cancelled"
                elif event.type == "approval_request":
                    # 工作流中暂不支持交互式审批，视为失败
                    if event.content:
                        output_parts.append(event.content)
                    final_status = "failed"
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
        await self._finalize_task(task_id, db_status, final_output)

        if final_status == "completed":
            await self.on_task_completed(task_id, final_output)
        else:
            await self.on_task_failed(task_id, final_output or final_status)

    async def _finalize_task(self, task_id: str, status: str, output: str):
        """更新 tasks 表的最终状态/结果。"""
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    UPDATE tasks
                    SET status = :status, completed_at = :now, result = :result
                    WHERE id = :id
                    """
                ),
                {"id": task_id, "now": _now_iso(), "status": status, "result": output},
            )
            await session.commit()

    async def _execute_condition_node(
        self, run_id: str, node: dict, context: dict
    ) -> Optional[str]:
        """评估条件，沿匹配的 edge 触发下游。"""
        node_id = node["id"]
        conditions = node.get("data", {}).get("conditions") or []
        edges = self._runs.get(run_id, {}).get("definition", {}).get("edges", [])
        nodes = self._runs.get(run_id, {}).get("definition", {}).get("nodes", [])

        target_edge_id = await self._evaluate_condition(conditions, context)

        chosen_edge = None
        if target_edge_id:
            chosen_edge = next((e for e in edges if e.get("id") == target_edge_id), None)

        # 如果没有匹配，使用 default 边（label == 'default' 或 isDefault）
        if not chosen_edge:
            outgoing = [e for e in edges if e.get("source") == node_id]
            chosen_edge = next(
                (e for e in outgoing if e.get("data", {}).get("isDefault") or e.get("label") in ("default", "否", "else")),
                None,
            )
            if not chosen_edge and outgoing:
                chosen_edge = outgoing[0]

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
        run_info = self._runs.get(run_id)
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

    async def on_task_completed(self, task_id: str, result: str):
        """Agent 任务完成回调。"""
        link = await self._find_node_run_by_task(task_id)
        if not link:
            return
        run_id, node_id = link

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

        context = await self._update_run_context(run_id, node_id, {"output": result})
        await self._execute_next_nodes(run_id, node_id, context)

    async def on_task_failed(self, task_id: str, error: str):
        link = await self._find_node_run_by_task(task_id)
        if not link:
            return
        run_id, node_id = link
        await self._update_node_status(run_id, node_id, "failed", error=error)

        # 查询节点配置，应用 onFailure 策略
        run_info = self._runs.get(run_id) or {}
        nodes = run_info.get("definition", {}).get("nodes", [])
        node = next((n for n in nodes if n["id"] == node_id), None)
        await self._handle_node_failure(run_id, node, error)

    async def on_approval_resolved(
        self, run_id: str, node_id: str, approved: bool, reason: str = ""
    ):
        if approved:
            await self._update_node_status(
                run_id, node_id, "completed", output="approved"
            )
            context = await self._update_run_context(
                run_id, node_id, {"output": "approved", "reason": reason}
            )
            await self._execute_next_nodes(run_id, node_id, context)
            return

        await self._update_node_status(
            run_id, node_id, "failed", error=reason or "rejected"
        )
        run_info = self._runs.get(run_id) or {}
        nodes = run_info.get("definition", {}).get("nodes", [])
        node = next((n for n in nodes if n["id"] == node_id), None)
        await self._handle_node_failure(run_id, node, reason or "rejected")

    # ── helpers: persistence ─────────────────────────────

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

    async def _update_run_context(
        self, run_id: str, node_id: str, node_data: dict
    ) -> dict:
        """合并节点输出到 context["<node_id>"]，并持久化。返回最新 context。"""
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
        return ctx

    async def _complete_run(self, run_id: str):
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    UPDATE workflow_runs
                    SET status = 'completed', completed_at = :now
                    WHERE id = :id
                    """
                ),
                {"id": run_id, "now": _now_iso()},
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
        await ws_hub.broadcast(
            "workflows",
            {"type": "workflow.run.completed", "run_id": run_id},
        )

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
            run_info = self._runs.get(run_id) or {}
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
        run_info = self._runs.get(run_id) or {}
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

    # ── DAG validation ───────────────────────────────────

    def _validate_dag(self, nodes: list, edges: list) -> bool:
        """循环检测 + 必要节点校验。"""
        if not nodes:
            raise ValueError("Workflow must have at least one node")

        node_ids = {n["id"] for n in nodes}
        starts = [n for n in nodes if n.get("type") == "start"]
        ends = [n for n in nodes if n.get("type") == "end"]
        if not starts:
            raise ValueError("Workflow must have a start node")
        if not ends:
            raise ValueError("Workflow must have an end node")

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
                raise ValueError(f"End node {e_node['id']} must have no outgoing edges")

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
        """渲染 {{path.to.value}} 模板。"""
        if not template:
            return ""

        def replace_match(match):
            path = match.group(1).strip()
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

        return re.sub(r"\{\{(.*?)\}\}", replace_match, template)

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
