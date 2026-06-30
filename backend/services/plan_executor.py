"""
Plan 并行执行引擎（asyncio 驱动）。

核心职责：
- 调度循环（_runner_loop）：1Hz 轮询数据库，按 ``max_parallel`` 控制并发，
  根据 ``depends_on`` 处理依赖与失败传播。
- 子任务执行（_run_plan_task）：复用 :class:`AgentExecutor`，可选 Git
  worktree 隔离，结束后跑测试 / diff，进入 review 或 completed 状态。
- 审批 / 提交 / 合并：与 plan_service / API 路由协作。

迁移自 ``tide_ws.py`` 的 ``plan_runner_loop`` / ``run_plan_task``
（L5471-5689），改写为完全异步、由 FastAPI 后端持久化驱动。
"""

from __future__ import annotations

import asyncio
import json
import logging
import shlex
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.runtime import git_utils
from backend.runtime.config import (
    APPROVED_CODEX_APPROVAL_POLICY,
    APPROVED_CODEX_SANDBOX_MODE,
    PLAN_MAX_PARALLEL,
    PLAN_TASK_OUTPUT_MAX_CHARS,
    PLAN_TEST_COMMAND,
    PLAN_TEST_COMMAND_SHELL,
    PLAN_TEST_TIMEOUT_SECONDS,
    PLAN_USE_WORKTREES,
)
from backend.runtime.executor import AgentExecutor
from backend.services.event_emitter import event_emitter

logger = logging.getLogger("tide.plan_executor")


# 终止状态集合（依赖检查使用）
_DEP_OK_STATUSES = {"completed", "committed", "merged", "done"}
_DEP_FAIL_STATUSES = {"failed", "cancelled", "stopped"}
_FINAL_STATUSES = _DEP_OK_STATUSES | _DEP_FAIL_STATUSES | {"rejected"}
_ACTIVE_STATUSES = {"queued", "running", "review", "pending_approval"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _truncate(text_value: str, limit: int = PLAN_TASK_OUTPUT_MAX_CHARS) -> str:
    text_value = (text_value or "").strip()
    if limit <= 0 or len(text_value) <= limit:
        return text_value
    return text_value[:limit].rstrip() + f"\n...（已截断，剩余 {len(text_value) - limit} 字）"


class PlanExecutor:
    """Plan 并行执行引擎（全局单例）。"""

    def __init__(self) -> None:
        self._running_plans: dict[str, asyncio.Task] = {}
        self._stop_signals: dict[str, asyncio.Event] = {}
        self._task_handles: dict[str, asyncio.Task] = {}  # f"{plan_id}:{task_id}"
        self._approval_events: dict[str, asyncio.Event] = {}
        self._approved_retry: set[str] = set()
        self._executor = AgentExecutor()

    # ── 公共 API ───────────────────────────────────────────

    async def start_plan(self, plan_id: str) -> None:
        """启动 Plan 调度循环；若已在运行则忽略。"""
        if plan_id in self._running_plans:
            return
        plan = await self._load_plan(plan_id)
        if not plan:
            logger.warning("[plan_executor] start_plan aborted: plan=%s not found in DB", plan_id[:8])
            return
        self._stop_signals[plan_id] = asyncio.Event()
        loop_task = asyncio.create_task(
            self._runner_loop(plan_id), name=f"plan-runner-{plan_id[:8]}"
        )
        self._running_plans[plan_id] = loop_task
        logger.info("[plan_executor] start plan=%s", plan_id[:8])

    async def resume_active_plans(self) -> None:
        """后端启动时扫描 DB，恢复所有 status='active' 或 'running' 的 Plan 的调度循环。"""
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    text(
                        "SELECT id FROM plans WHERE status IN ('active', 'running')"
                    )
                )
                plan_ids = [row[0] for row in result.fetchall()]
        except Exception:  # noqa: BLE001
            logger.exception("[plan_executor] resume_active_plans: query failed")
            return

        if not plan_ids:
            logger.debug("[plan_executor] resume_active_plans: no active plans found")
            return

        recovered = 0
        for plan_id in plan_ids:
            try:
                await self.start_plan(plan_id)
                recovered += 1
            except Exception:  # noqa: BLE001
                logger.exception(
                    "[plan_executor] resume_active_plans: start_plan failed plan=%s",
                    plan_id[:8] if isinstance(plan_id, str) else plan_id,
                )
        logger.info(
            "[plan_executor] resume_active_plans: recovered %d/%d active plan(s)",
            recovered,
            len(plan_ids),
        )

    async def stop_plan(self, plan_id: str) -> None:
        """发送停止信号并取消所有运行中的子任务。"""
        ev = self._stop_signals.get(plan_id)
        if ev is not None:
            ev.set()
        prefix = f"{plan_id}:"
        for key, handle in list(self._task_handles.items()):
            if key.startswith(prefix) and not handle.done():
                handle.cancel()
        # 设置 approval event，防止有任务正阻塞在等待审批
        for key, ev in list(self._approval_events.items()):
            if key.startswith(prefix):
                ev.set()
        logger.info("[plan_executor] stop signal sent: plan=%s", plan_id[:8])

    async def approve_task(self, plan_id: str, task_id: str) -> bool:
        """审批通过：唤醒等待中的子任务，并使用 approved 模式重新执行。"""
        key = f"{plan_id}:{task_id}"
        self._approved_retry.add(key)
        ev = self._approval_events.get(key)
        if ev is not None:
            ev.set()
            return True
        # 当前没有 pending approval：直接重置任务状态并触发调度
        task = await self._load_task(task_id)
        if not task:
            return False
        if task["status"] not in ("review", "failed"):
            return False
        await self._update_task(
            task_id,
            status="queued",
            result=None,
            started_at=None,
            completed_at=None,
        )
        await self._ensure_runner(plan_id)
        return True

    async def commit_task(self, plan_id: str, task_id: str, commit: bool) -> dict:
        """对处于 review 状态的子任务执行提交 / 跳过。"""
        task = await self._load_task(task_id)
        if not task:
            return {"ok": False, "error": "task not found"}
        if task.get("status") not in ("review",):
            return {"ok": False, "error": f"task status={task.get('status')} not in review"}

        cwd = self._task_runtime_cwd(task)
        if not commit:
            await self._update_task(
                task_id,
                status="completed",
                result=(
                    "已跳过提交；改动仍保留在子任务 worktree 中。\n"
                    f"`{cwd}`"
                ),
                completed_at=_now_iso(),
            )
            await self._emit_status(task, "completed")
            return {"ok": True, "skipped": True}

        message = task.get("commit_message") or self._build_commit_message(plan_id, task)
        commit_hash = await git_utils.commit_changes(cwd, message)
        if not commit_hash:
            # 没有改动 → 完成；其它失败 → 保持 review
            if not await git_utils.has_git_changes(cwd):
                await self._update_task(
                    task_id,
                    status="completed",
                    result="没有可提交的改动，已标记完成。",
                    completed_at=_now_iso(),
                )
                await self._emit_status(task, "completed")
                return {"ok": True, "skipped": True}
            return {"ok": False, "error": "git commit failed"}

        await self._update_task(
            task_id,
            status="committed",
            commit_hash=commit_hash,
            commit_message=message,
            result=(
                f"已提交到子任务分支 `{task.get('branch_name') or '-'}`。\n"
                f"Commit：`{commit_hash}`\n"
                f"提交信息：`{message}`"
            ),
            completed_at=_now_iso(),
        )
        await self._emit_status(task, "committed")
        return {"ok": True, "commit_hash": commit_hash}

    async def merge_task(self, plan_id: str, task_id: str) -> tuple[bool, str]:
        """cherry-pick 合并单个已提交的子任务到主分支。"""
        task = await self._load_task(task_id)
        if not task:
            return False, "task not found"
        commit_hash = task.get("commit_hash") or ""
        if task.get("status") != "committed" or not commit_hash:
            return False, "task is not in committed state"

        plan = await self._load_plan(plan_id)
        if not plan:
            return False, "plan not found"
        repo_root = await git_utils.git_repo_root(Path(plan.get("cwd") or "."))
        if not repo_root:
            return False, "plan cwd is not a git repository"

        is_repo, entries, _ = await git_utils.git_status_entries(repo_root)
        if is_repo and entries:
            return False, "main worktree has pending changes; please commit/stash first"

        ok, output = await git_utils.cherry_pick_task(repo_root, commit_hash)
        if ok:
            await self._update_task(task_id, merge_status="merged", status="merged")
            await self._emit_status(task, "merged")
            return True, output or f"cherry-pick {commit_hash} success"

        conflicts = await git_utils.git_conflict_files(repo_root)
        merge_status = "conflict" if conflicts else "failed"
        await self._update_task(task_id, merge_status=merge_status)
        conflict_text = ("\n冲突文件：\n" + "\n".join(conflicts[:20])) if conflicts else ""
        return False, f"cherry-pick failed.\n{output}{conflict_text}"

    async def merge_all(self, plan_id: str) -> tuple[int, int, list[str]]:
        """按 task_index 顺序合并所有 committed 子任务。

        Returns:
            (merged_count, failed_count, conflict_task_ids)
        """
        tasks = await self._load_plan_tasks(plan_id)
        merged = 0
        failed = 0
        conflicts: list[str] = []
        for t in tasks:
            if t.get("status") != "committed" or not t.get("commit_hash"):
                continue
            if t.get("merge_status") == "merged":
                continue
            ok, _msg = await self.merge_task(plan_id, t["id"])
            if ok:
                merged += 1
            else:
                failed += 1
                conflicts.append(t["id"])
                # 出现冲突 / 失败立即停止，等待人工干预
                break
        return merged, failed, conflicts

    # ── 调度循环 ───────────────────────────────────────────

    async def _runner_loop(self, plan_id: str) -> None:
        """1Hz 调度循环：依赖检查 + 并发槽位控制 + 失败传播。"""
        try:
            stop_event = self._stop_signals[plan_id]
            while not stop_event.is_set():
                plan = await self._load_plan(plan_id)
                if not plan:
                    logger.warning("[plan_executor] runner_loop exit: plan=%s not found", plan_id[:8])
                    return

                if plan.get("status") not in ("active", "running"):
                    logger.warning(
                        "[plan_executor] runner_loop exit: plan=%s status=%s (not active/running)",
                        plan_id[:8], plan.get("status"),
                    )
                    return

                tasks = await self._load_plan_tasks(plan_id)
                if not tasks:
                    await self._mark_plan_done(plan_id, tasks)
                    return

                # 失败传播 / 依赖检查
                index_to_task = {t["task_index"]: t for t in tasks}
                running_ids = [t["id"] for t in tasks if t.get("status") == "running"]
                ready: list[dict] = []
                for t in tasks:
                    if t.get("status") not in ("queued",):
                        continue
                    deps = self._parse_depends_on(t.get("depends_on"))
                    # 过滤自引用依赖（防止 task 依赖自身导致死锁）
                    task_index = t.get("task_index")
                    if task_index is not None:
                        deps = [d for d in deps if d != task_index]
                    state, reason = self._check_dependencies(deps, index_to_task)
                    if state == "ok":
                        ready.append(t)
                    elif state == "failed":
                        await self._update_task(
                            t["id"],
                            status="failed",
                            result=reason,
                            completed_at=_now_iso(),
                        )
                        await self._emit_status(t, "failed")
                    # state == "wait" → 继续等待

                max_parallel = int(plan.get("max_parallel") or PLAN_MAX_PARALLEL)
                slots = max(0, max_parallel - len(running_ids))

                logger.debug(
                    "[plan_executor] loop plan=%s: running=%d queued=%d ready=%d slots=%d",
                    plan_id[:8], len(running_ids),
                    sum(1 for t in tasks if t.get("status") == "queued"),
                    len(ready), slots,
                )

                for t in ready[:slots]:
                    logger.info(
                        "[plan_executor] launching task=%s (index=%s) for plan=%s",
                        t["id"][:8], t.get("task_index"), plan_id[:8],
                    )
                    self._launch_task(plan_id, t["id"])

                # 终止条件：没有任何活动任务
                if not any(t.get("status") in _ACTIVE_STATUSES for t in tasks):
                    await self._mark_plan_done(plan_id, tasks)
                    return

                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass
        except asyncio.CancelledError:
            logger.info("[plan_executor] runner cancelled: plan=%s", plan_id[:8])
            raise
        except Exception:  # noqa: BLE001
            logger.exception("[plan_executor] runner loop error: plan=%s", plan_id)
        finally:
            self._running_plans.pop(plan_id, None)
            self._stop_signals.pop(plan_id, None)

    def _launch_task(self, plan_id: str, task_id: str) -> None:
        """为 ready 任务创建 _run_plan_task asyncio.Task。"""
        key = f"{plan_id}:{task_id}"
        existing = self._task_handles.get(key)
        if existing is not None and not existing.done():
            return
        handle = asyncio.create_task(
            self._run_plan_task(plan_id, task_id), name=f"plan-task-{task_id[:8]}"
        )
        self._task_handles[key] = handle

        def _cleanup(_t: asyncio.Task) -> None:
            self._task_handles.pop(key, None)

        handle.add_done_callback(_cleanup)

    async def _ensure_runner(self, plan_id: str) -> None:
        if plan_id in self._running_plans:
            return
        await self.start_plan(plan_id)

    async def _mark_plan_done(self, plan_id: str, tasks: list[dict]) -> None:
        """根据子任务结局更新 Plan 终态。"""
        if any(t.get("status") in ("failed", "cancelled", "stopped") for t in tasks):
            new_status = "failed"
        elif tasks and all(
            t.get("status") in ("completed", "committed", "merged") for t in tasks
        ):
            new_status = "completed"
        else:
            new_status = "completed"

        async with async_session_factory() as session:
            await session.execute(
                text(
                    "UPDATE plans SET status = :status, completed_at = :ts "
                    "WHERE id = :plan_id"
                ),
                {"status": new_status, "ts": _now_iso(), "plan_id": plan_id},
            )
            await session.commit()
        logger.info(
            "[plan_executor] plan finished: plan=%s status=%s",
            plan_id[:8],
            new_status,
        )

        # Plan 完成后，查找关联工作项并触发节点推进
        if new_status == "completed":
            await self._advance_linked_work_item(plan_id)

    async def _advance_linked_work_item(self, plan_id: str) -> None:
        """Plan 完成后，通过 work_item_transitions 查找关联工作项并触发推进。

        幂等安全：on_work_item_task_completed 内部会检查 current_node_id 是否已过，
        重复调用不会双重推进。
        """
        try:
            async with async_session_factory() as session:
                row = (await session.execute(
                    text("""
                        SELECT wit.work_item_id, wit.to_node_id, t.id as task_id
                        FROM work_item_transitions wit
                        JOIN tasks t ON t.id = wit.task_id
                        WHERE t.plan_id = :plan_id
                        LIMIT 1
                    """),
                    {"plan_id": plan_id},
                )).fetchone()

            if not row:
                logger.debug(
                    "[plan_executor] No linked work item for plan=%s, skip advance.",
                    plan_id[:8],
                )
                return

            mapping = dict(row._mapping)
            task_id = mapping["task_id"]

            # 延迟导入避免循环依赖
            from backend.services.work_item_service import work_item_service
            await work_item_service.on_work_item_task_completed(task_id, "plan_completed")
            logger.info(
                "[plan_executor] Triggered work item advance for plan=%s via task=%s",
                plan_id[:8], task_id[:8],
            )
        except Exception as exc:
            logger.warning(
                "[plan_executor] Failed to advance work item for plan=%s: %s",
                plan_id[:8], exc,
            )

    # ── 子任务执行 ─────────────────────────────────────────

    async def _run_plan_task(self, plan_id: str, task_id: str) -> None:
        """单个子任务执行流程。"""
        task = await self._load_task(task_id)
        if not task:
            return

        plan = await self._load_plan(plan_id)
        if not plan:
            return

        # ── workflow_id 集成（可选）──────────────────────
        # 若 plan definition 中该子任务节点的 data 配置了 workflow_id，则同步
        # 创建一个 work_item，由 work_item_service 按工作流阶段自动流转。
        # Plan task 仍按原逻辑继续执行，不被阻塞。
        try:
            task_workflow_id = await self._lookup_task_workflow_id(plan, task_id)
        except Exception:  # noqa: BLE001
            logger.debug("[plan_executor] workflow_id lookup failed", exc_info=True)
            task_workflow_id = None

        if task_workflow_id:
            await self._create_plan_work_item(plan_id, task_id, task, task_workflow_id)

        # 优先使用任务级别的 cwd（跨仓库 Plan 场景下每个任务有独立的仓库）
        task_cwd = Path(task.get("cwd") or plan.get("cwd") or ".")
        worktree_path = ""
        branch_name = ""
        run_cwd = task_cwd

        if PLAN_USE_WORKTREES:
            wt, br, _base = await git_utils.prepare_plan_worktree(
                plan_id, task_id, task_cwd
            )
            if str(wt):
                worktree_path = str(wt)
                branch_name = br
                run_cwd = wt

        await self._update_task(
            task_id,
            status="running",
            worktree_path=worktree_path or None,
            branch_name=branch_name or None,
            started_at=_now_iso(),
            result=None,
        )
        await self._emit_status(task, "running")

        agent_id = task.get("agent_id") or "codex"
        prompt = task.get("prompt") or ""
        model = task.get("model") or ""
        key = f"{plan_id}:{task_id}"
        approved_retry = key in self._approved_retry

        output_chunks: list[str] = []
        agent_output_chunks: list[str] = []  # 仅跟踪 agent 的自然语言回复，排除 tool_output/progress
        approval_pending = False  # full_auto 模式不会进入审批流程
        final_status: Optional[str] = None
        final_message = ""
        try:
            async for event in self._executor.run_task(
                task_id=task_id,
                agent_id=agent_id,
                prompt=prompt,
                cwd=str(run_cwd),
                model=model,
                full_auto=True,
            ):
                if event.type in ("output", "tool_output", "progress"):
                    if event.content:
                        output_chunks.append(event.content)
                        await self._append_result(task_id, event.content)
                        await event_emitter.emit_task_output(
                            task_id,
                            task["workspace_id"],
                            event.content,
                            event.type,
                        )
                        # 仅收集 agent 的自然语言回复（不含 tool_output/progress）
                        if event.type == "output":
                            agent_output_chunks.append(event.content)
                elif event.type == "session_id":
                    if event.session_id:
                        await self._update_task(task_id, session_id=event.session_id)
                elif event.type == "approval_request":
                    # plan_executor 始终以 full_auto=True 运行，不应收到审批请求
                    logger.error(
                        "[plan_executor] unexpected approval_request in full_auto mode, "
                        "plan=%s task=%s",
                        plan_id[:8], task_id[:8],
                    )
                    final_status = "failed"
                    final_message = event.content or "Unexpected approval request in full_auto mode"
                    break
                elif event.type == "completed":
                    final_status = "completed"
                    final_message = event.content or ""
                elif event.type == "failed":
                    final_status = "failed"
                    final_message = event.content or "agent failed"
                elif event.type == "cancelled":
                    final_status = "cancelled"
                    final_message = "Task was cancelled"
                # started 等其它类型忽略
        except asyncio.CancelledError:
            await self._executor.cancel_task(task_id)
            await self._update_task(
                task_id,
                status="cancelled",
                result="子任务被取消。",
                completed_at=_now_iso(),
            )
            await self._emit_status(task, "cancelled")
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "[plan_executor] task execution error: plan=%s task=%s",
                plan_id[:8],
                task_id[:8],
            )
            await self._update_task(
                task_id,
                status="failed",
                result=f"执行异常：{type(exc).__name__}: {exc}",
                completed_at=_now_iso(),
            )
            task_after = await self._load_task(task_id) or task
            await self._emit_status(task_after, "failed")
            return

        if approval_pending:
            # 等待 approve_task 触发
            return

        # 将 agent 的自然语言回复单独存储到 agent_final_output，
        # 供下游工作流节点提取 agent 的最终结论（而非完整日志）。
        if agent_output_chunks:
            try:
                final_output_text = "\n".join(agent_output_chunks)
                async with async_session_factory() as session:
                    await session.execute(
                        text(
                            "UPDATE tasks SET agent_final_output = :output WHERE id = :task_id"
                        ),
                        {"output": final_output_text, "task_id": task_id},
                    )
                    await session.commit()
            except Exception:  # noqa: BLE001
                logger.debug("Failed to save agent_final_output for task=%s", task_id[:8], exc_info=True)

        # 正常结束，进入 finalize（test + diff → review/completed/failed）
        await self._finalize_task(plan_id, task_id, final_status, final_message, run_cwd)

    async def _finalize_task(
        self,
        plan_id: str,
        task_id: str,
        agent_status: Optional[str],
        agent_output: str,
        cwd: Path,
    ) -> None:
        """跑测试 + diff，决定最终状态。"""
        task = await self._load_task(task_id)
        if not task:
            return

        if agent_status == "cancelled":
            await self._update_task(
                task_id,
                status="cancelled",
                result=agent_output or "Cancelled",
                completed_at=_now_iso(),
            )
            await self._emit_status(task, "cancelled")
            return

        test_ok, test_summary = await self._run_test_command(cwd)
        changed = await git_utils.has_git_changes(cwd)
        diff_summary = await git_utils.git_diff_summary(cwd) if changed else ""
        commit_message = self._build_commit_message(plan_id, task) if changed else ""

        parts: list[str] = []
        if agent_output:
            parts.append(_truncate(agent_output))
        parts.append(f"**测试**\n{test_summary}")
        if changed:
            parts.append(f"**改动摘要**\n{_truncate(diff_summary, 1600)}")
        if task.get("worktree_path"):
            parts.append(
                f"**Worktree**\n`{task['worktree_path']}`\n"
                f"**分支**\n`{task.get('branch_name') or '-'}`"
            )

        if agent_status == "failed":
            new_status = "failed"
            if not agent_output:
                parts.insert(0, "任务失败。")
        elif not test_ok:
            new_status = "failed"
            parts.insert(0, "任务已结束，但测试未通过，暂不进入提交审批。")
        elif changed:
            new_status = "review"
            parts.append(f"**待提交审批**\n提交信息：`{commit_message}`")
        else:
            new_status = "completed"
            if not agent_output:
                parts.insert(0, "任务完成，未检测到代码改动。")

        await self._update_task(
            task_id,
            status=new_status,
            result="\n\n".join(p for p in parts if p),
            test_result=test_summary,
            diff_summary=diff_summary or None,
            commit_message=commit_message or None,
            completed_at=_now_iso() if new_status != "review" else None,
        )
        task_after = await self._load_task(task_id) or task
        await self._emit_status(task_after, new_status)

    async def _run_test_command(self, cwd: Path) -> tuple[bool, str]:
        """执行 PLAN_TEST_COMMAND；未配置或目录不存在则返回 (True, 跳过)。"""
        if not PLAN_TEST_COMMAND or not str(PLAN_TEST_COMMAND).strip():
            return True, "未配置 PLAN_TEST_COMMAND，跳过测试。"
        if not cwd or not Path(cwd).is_dir():
            return False, f"测试目录不存在：{cwd}"
        try:
            if PLAN_TEST_COMMAND_SHELL:
                proc = await asyncio.create_subprocess_shell(
                    PLAN_TEST_COMMAND,
                    cwd=str(cwd),
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
            else:
                argv = shlex.split(PLAN_TEST_COMMAND)
                if not argv:
                    return True, "PLAN_TEST_COMMAND 解析为空。"
                proc = await asyncio.create_subprocess_exec(
                    *argv,
                    cwd=str(cwd),
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
        except FileNotFoundError as e:
            return False, f"找不到测试命令：{e}"
        except Exception as e:  # noqa: BLE001
            return False, f"启动测试命令失败：{type(e).__name__}: {e}"

        try:
            stdout, _ = await asyncio.wait_for(
                proc.communicate(), timeout=PLAN_TEST_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
            return False, f"测试命令超时（>{PLAN_TEST_TIMEOUT_SECONDS}s）。"

        output = (stdout or b"").decode("utf-8", errors="replace").strip()
        ok = proc.returncode == 0
        head = f"`{PLAN_TEST_COMMAND}` 退出码 {proc.returncode}"
        body = _truncate(output, 1200)
        return ok, head if not body else f"{head}\n```\n{body}\n```"

    # ── 数据库辅助 ─────────────────────────────────────────

    async def _load_plan(self, plan_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT id, workspace_id, cwd, model, status, max_parallel, "
                        "definition, created_at, completed_at "
                        "FROM plans WHERE id = :plan_id"
                    ),
                    {"plan_id": plan_id},
                )
            ).fetchone()
            return dict(row._mapping) if row else None

    async def _load_task(self, task_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT id, workspace_id, plan_id, prompt, cwd, model, "
                        "agent_id, session_id, status, result, worktree_path, "
                        "branch_name, diff_summary, test_result, commit_hash, "
                        "commit_message, merge_status, started_at, completed_at "
                        "FROM tasks WHERE id = :task_id"
                    ),
                    {"task_id": task_id},
                )
            ).fetchone()
            return dict(row._mapping) if row else None

    async def _load_plan_tasks(self, plan_id: str) -> list[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT t.id, t.workspace_id, t.status, t.prompt, t.cwd, "
                    "t.agent_id, t.model, t.commit_hash, t.merge_status, "
                    "t.worktree_path, t.branch_name, "
                    "pt.task_index, pt.phase, pt.depends_on "
                    "FROM plan_tasks pt JOIN tasks t ON t.id = pt.task_id "
                    "WHERE pt.plan_id = :plan_id "
                    "ORDER BY pt.task_index"
                ),
                {"plan_id": plan_id},
            )
            return [dict(r._mapping) for r in result.fetchall()]

    async def _update_task(self, task_id: str, **fields: object) -> None:
        if not fields:
            return
        sets = []
        params: dict = {"task_id": task_id}
        for key, value in fields.items():
            sets.append(f"{key} = :{key}")
            params[key] = value
        # 当设置 completed_at 时，确保 started_at 有值
        if "completed_at" in fields and "started_at" not in fields:
            sets.append(
                "started_at = CASE WHEN started_at IS NULL THEN "
                "COALESCE(created_at, :fallback_started) ELSE started_at END"
            )
            params["fallback_started"] = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text(f"UPDATE tasks SET {', '.join(sets)} WHERE id = :task_id"),
                params,
            )
            # 自动维护 duration_ms
            await session.execute(
                text(
                    "UPDATE tasks SET duration_ms = "
                    "CASE WHEN started_at IS NOT NULL AND completed_at IS NOT NULL "
                    "THEN CAST((julianday(completed_at) - julianday(started_at)) * 86400000 AS INTEGER) "
                    "ELSE duration_ms END "
                    "WHERE id = :task_id"
                ),
                {"task_id": task_id},
            )
            await session.commit()

    async def _append_result(self, task_id: str, chunk: str) -> None:
        if not chunk:
            return
        async with async_session_factory() as session:
            await session.execute(
                text(
                    "UPDATE tasks SET result = "
                    "CASE WHEN result IS NULL OR result = '' THEN :chunk "
                    "ELSE result || char(10) || :chunk END "
                    "WHERE id = :task_id"
                ),
                {"task_id": task_id, "chunk": chunk},
            )
            await session.commit()

    async def _emit_status(self, task: dict, new_status: str) -> None:
        try:
            await event_emitter.emit_task_status_changed(
                task["id"],
                task.get("workspace_id") or "default",
                task.get("status") or "queued",
                new_status,
            )
        except Exception:  # noqa: BLE001
            logger.debug("emit_task_status_changed failed", exc_info=True)

    # ── 内部小工具 ─────────────────────────────────────────

    def _parse_depends_on(self, raw: object) -> list[int]:
        if raw is None:
            return []
        if isinstance(raw, list):
            return [int(x) for x in raw if isinstance(x, (int, str)) and str(x).strip()]
        if isinstance(raw, str) and raw.strip():
            try:
                value = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return []
            if isinstance(value, list):
                return [int(x) for x in value if str(x).strip().lstrip("-").isdigit()]
        return []

    def _check_dependencies(
        self, deps: list[int], index_to_task: dict[int, dict]
    ) -> tuple[str, str]:
        """返回 ('ok' | 'wait' | 'failed', reason)。"""
        for dep_index in deps:
            dep_task = index_to_task.get(dep_index)
            if not dep_task:
                return "failed", f"找不到依赖任务索引 {dep_index}。"
            status = dep_task.get("status") or ""
            if status in _DEP_FAIL_STATUSES:
                return (
                    "failed",
                    f"依赖任务 {dep_task.get('id', '')[:8]}（index={dep_index}）状态={status}，已传播失败。",
                )
            if status not in _DEP_OK_STATUSES:
                return "wait", f"等待依赖任务 index={dep_index} 完成（当前 {status}）。"
        return "ok", ""

    def _task_runtime_cwd(self, task: dict) -> Path:
        wt = task.get("worktree_path")
        if wt:
            return Path(wt)
        return Path(task.get("cwd") or ".")

    def _build_commit_message(self, plan_id: str, task: dict) -> str:
        prompt = (task.get("prompt") or "").strip().splitlines()
        title = prompt[0] if prompt else "tide task"
        return f"tide(plan {plan_id[:8]}): {title[:80]}"

    async def _lookup_task_workflow_id(
        self, plan: dict, task_id: str
    ) -> Optional[str]:
        """从 plan definition + plan_tasks 映射中查找子任务的 workflow_id。

        返回 None 表示该子任务未配置工作流，走默认 Agent 执行路径。
        """
        try:
            raw = plan.get("definition") if isinstance(plan, dict) else None
            if not raw:
                return None
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode("utf-8", errors="replace")
            if isinstance(raw, str):
                try:
                    definition = json.loads(raw)
                except json.JSONDecodeError:
                    return None
            elif isinstance(raw, dict):
                definition = raw
            else:
                return None

            tasks_def = definition.get("tasks") if isinstance(definition, dict) else None
            if not isinstance(tasks_def, list) or not tasks_def:
                return None

            # 查 plan_tasks 获取当前 task 的 task_index
            async with async_session_factory() as session:
                row = (
                    await session.execute(
                        text(
                            "SELECT task_index FROM plan_tasks "
                            "WHERE task_id = :task_id LIMIT 1"
                        ),
                        {"task_id": task_id},
                    )
                ).fetchone()
            if not row:
                return None
            idx = dict(row._mapping).get("task_index")
            if idx is None or idx < 0 or idx >= len(tasks_def):
                return None

            task_def = tasks_def[idx] or {}
            wf = None
            if isinstance(task_def, dict):
                # 优先取 task_def.data.workflow_id（前端节点 data 结构）
                data = task_def.get("data")
                if isinstance(data, dict):
                    wf = data.get("workflow_id")
                # 兼容顶层 workflow_id
                if not wf:
                    wf = task_def.get("workflow_id")
            return wf if isinstance(wf, str) and wf.strip() else None
        except Exception:  # noqa: BLE001
            logger.debug("_lookup_task_workflow_id failed", exc_info=True)
            return None

    async def _create_plan_work_item(
        self, plan_id: str, task_id: str, task: dict, workflow_id: str
    ) -> None:
        """为 Plan 子任务创建对应的 work_item，按工作流阶段流转。

        - 通过 project_settings 表反查 workflow_id 绑定的 project_id
        - 调用 work_item_service.create_work_item，source_type='plan', source_id=task_id
        - 异常被吞下，不影响 Plan 主流程
        """
        try:
            # 延迟导入避免循环依赖
            from backend.services.work_item_service import work_item_service

            # 反查绑定的 project_id
            async with async_session_factory() as session:
                row = (
                    await session.execute(
                        text(
                            "SELECT project_id FROM project_settings "
                            "WHERE workflow_id = :workflow_id LIMIT 1"
                        ),
                        {"workflow_id": workflow_id},
                    )
                ).fetchone()

            if not row:
                logger.warning(
                    "[plan_executor] workflow_id=%s 未绑定任何 project，跳过 work_item 创建 (plan=%s task=%s)",
                    workflow_id[:8], plan_id[:8], task_id[:8],
                )
                return

            project_id = dict(row._mapping).get("project_id")
            if not project_id:
                return

            prompt = (task.get("prompt") or "").strip()
            first_line = prompt.splitlines()[0] if prompt else ""
            title = (first_line or f"Plan task {task_id[:8]}")[:120]

            item = await work_item_service.create_work_item({
                "project_id": project_id,
                "title": title,
                "description": prompt or None,
                "priority": 0,
                "assignee": None,
                "source_type": "plan",
                "source_id": task_id,
                "metadata": {
                    "plan_id": plan_id,
                    "plan_task_id": task_id,
                    "workflow_id": workflow_id,
                },
            })
            logger.info(
                "[plan_executor] work_item created: item=%s project=%s workflow=%s plan=%s task=%s",
                (item.get("id") or "")[:8] if isinstance(item, dict) else "-",
                project_id[:8],
                workflow_id[:8],
                plan_id[:8],
                task_id[:8],
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "[plan_executor] create_work_item failed: plan=%s task=%s workflow=%s",
                plan_id[:8], task_id[:8], workflow_id[:8],
            )


# 全局单例
plan_executor = PlanExecutor()
