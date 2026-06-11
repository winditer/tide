"""
TaskService — 任务 CRUD + Agent 执行桥接层。

桥接 runtime/adapters.py 中的 AGENT_ADAPTERS，提供：
- create_task: 写 DB + 启动 Agent 后台线程（真实 CLI）
- list_tasks: 筛选 + 分页
- get_task / stop_task / approve_task / reject_task / retry_task
"""

import asyncio
import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.event_emitter import event_emitter
from backend.runtime.adapters import AGENT_ADAPTERS
from backend.runtime.executor import agent_executor, TaskEvent
from backend.runtime.task_runtime import TASKS, CodexTaskRuntime, LOCK

logger = logging.getLogger("tide.task_service")


class TaskService:
    # ── helpers ──────────────────────────────────────────

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _short_id(task_id: str) -> str:
        return task_id[:8]

    async def _update_status(
        self,
        task_id: str,
        workspace_id: str,
        new_status: str,
        old_status: str = "",
        result: Optional[str] = None,
    ):
        """更新任务状态，广播 WS。事件记录由 event_emitter 处理。"""
        if not old_status:
            existing = await self.get_task(task_id)
            old_status = str((existing or {}).get("status") or "")

        async with async_session_factory() as session:
            sets = ["status = :new_status"]
            params: dict = {"new_status": new_status}

            if new_status == "running":
                sets.append("started_at = :started_at")
                params["started_at"] = self._now_iso()
            if new_status in ("completed", "failed", "stopped", "rejected", "approved"):
                sets.append("completed_at = :completed_at")
                params["completed_at"] = self._now_iso()
            if result is not None:
                sets.append("result = :result")
                params["result"] = result

            params["task_id"] = task_id

            await session.execute(
                text(f"UPDATE tasks SET {', '.join(sets)} WHERE id = :task_id"),
                params,
            )

            # recalculate duration_ms
            await session.execute(
                text("""
                UPDATE tasks SET duration_ms = 
                    CASE WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
                         THEN CAST((julianday(completed_at) - julianday(started_at)) * 86400000 AS INTEGER)
                         ELSE NULL END
                WHERE id = :task_id
                """),
                {"task_id": task_id},
            )
            await session.commit()

        with LOCK:
            runtime = TASKS.get(task_id)
            if runtime:
                runtime.status = new_status

        # broadcast via event_emitter
        await event_emitter.emit_task_status_changed(
            task_id, workspace_id, old_status, new_status,
        )

        # 事件驱动通知 work_item_service（幂等，调用会自动跳过未关联的任务）。
        if new_status in ("completed", "failed", "stopped", "rejected"):
            try:
                from backend.services.work_item_service import work_item_service
                logger.info(
                    "Notifying work_item_service: task=%s status=%s",
                    self._short_id(task_id), new_status,
                )
                # 使用最新 result（可能是传入参数或 DB 中之前的追加输出）
                final_result = result
                if final_result is None:
                    refreshed = await self.get_task(task_id)
                    final_result = str((refreshed or {}).get("result") or "")
                asyncio.create_task(
                    work_item_service.on_work_item_task_completed(
                        task_id, final_result or "",
                    )
                )
            except Exception:
                logger.debug(
                    "work_item_service.on_work_item_task_completed dispatch failed for task=%s",
                    self._short_id(task_id),
                    exc_info=True,
                )

    async def _append_result_chunk(
        self,
        task_id: str,
        chunk: str,
    ) -> None:
        """Persist streamed output so detail/SSE readers can replay it."""
        if not chunk:
            return
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE tasks
                SET result =
                    CASE
                        WHEN result IS NULL OR result = '' THEN :chunk
                        ELSE result || char(10) || :chunk
                    END
                WHERE id = :task_id
                """),
                {"task_id": task_id, "chunk": chunk},
            )
            await session.commit()

    async def _finish_with_result(
        self,
        task_id: str,
        workspace_id: str,
        new_status: str,
        result: str = "",
    ) -> None:
        existing = await self.get_task(task_id)
        existing_result = str((existing or {}).get("result") or "").strip()
        final_result = result
        if existing_result:
            final_result = existing_result
            if result and result.strip() and result.strip() not in existing_result:
                final_result = f"{existing_result}\n{result.strip()}"
        await self._update_status(
            task_id,
            workspace_id,
            new_status,
            result=final_result,
        )

    # ── create ───────────────────────────────────────────

    async def create_task(
        self,
        workspace_id: str,
        prompt: str,
        agent_id: str = "codex",
        model: str = "",
        cwd: str = "",
        attachments: Optional[list[str]] = None,
        chat_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
        session_id: str = "",
        full_auto: bool = False,
    ) -> dict:
        """创建任务：写 DB + 启动真实 Agent CLI。"""
        task_id = str(uuid.uuid4())
        now = self._now_iso()

        if agent_id not in AGENT_ADAPTERS:
            choices = ", ".join(sorted(AGENT_ADAPTERS))
            raise ValueError(f"Unsupported agent_id: {agent_id!r}. Available agents: {choices}")

        # fallback cwd
        if not cwd:
            cwd = str(Path.cwd())

        attachments_json = json.dumps(attachments or [], ensure_ascii=False)

        # 写入数据库
        async with async_session_factory() as session:
            await session.execute(
                text("""
                INSERT INTO tasks
                    (id, workspace_id, chat_id, session_id, prompt, agent_id, model, cwd, attachments, status, created_at)
                VALUES (:id, :workspace_id, :chat_id, :session_id, :prompt, :agent_id, :model, :cwd, :attachments, 'queued', :created_at)
                """),
                {
                    "id": task_id,
                    "workspace_id": workspace_id,
                    "chat_id": chat_id,
                    "session_id": session_id or None,
                    "prompt": prompt,
                    "agent_id": agent_id,
                    "model": model or None,
                    "cwd": cwd,
                    "attachments": attachments_json,
                    "created_at": now,
                },
            )
            await session.commit()

        # 写入内存 TASKS 字典
        runtime = CodexTaskRuntime(
            task_id=task_id,
            chat_id=chat_id or "",
            cwd=Path(cwd),
            prompt=prompt,
            agent_id=agent_id,
            model=model,
            status="queued",
            session_id=session_id or "",
            conversation_id=conversation_id or "",
        )
        with LOCK:
            TASKS[task_id] = runtime

        # emit task.created via event_emitter
        await event_emitter.emit_task_created(task_id, workspace_id)

        self._schedule_agent_start(task_id, workspace_id, agent_id, prompt, cwd, model,
                                    conversation_id=conversation_id or "",
                                    full_auto=full_auto)

        # 查询并返回
        return await self.get_task(task_id)

    # ── agent execution ───────────────────────────────────

    def _schedule_agent_start(
        self,
        task_id: str,
        workspace_id: str,
        agent_id: str,
        prompt: str,
        cwd: str,
        model: str,
        approved_retry: bool = False,
        conversation_id: str = "",
        full_auto: bool = False,
    ) -> None:
        """启动 Agent；缺少 CLI 时显式失败，不伪造成功结果。"""
        adapter = AGENT_ADAPTERS.get(agent_id)
        if adapter is None:
            asyncio.create_task(
                self._fail_agent_unavailable(task_id, workspace_id, "")
            )
            return
        if not adapter.bin_name or shutil.which(adapter.bin_name) is None:
            asyncio.create_task(
                self._fail_agent_unavailable(task_id, workspace_id, adapter.bin_name)
            )
            return

        asyncio.create_task(
            self._run_agent_real(
                task_id,
                workspace_id,
                agent_id,
                prompt,
                cwd,
                model,
                approved_retry=approved_retry,
                conversation_id=conversation_id,
                full_auto=full_auto,
            )
        )

    async def _fail_agent_unavailable(
        self,
        task_id: str,
        workspace_id: str,
        bin_name: str = "",
    ) -> None:
        detail = (
            f"Agent CLI not found: {bin_name}. Make sure it is installed and available in PATH."
            if bin_name
            else "Agent CLI is not configured for this agent."
        )
        logger.warning("Agent unavailable for task %s: %s", self._short_id(task_id), detail)
        await self._update_status(task_id, workspace_id, "failed", result=detail)
        with LOCK:
            TASKS.pop(task_id, None)

    async def _run_agent_real(
        self,
        task_id: str,
        workspace_id: str,
        agent_id: str,
        prompt: str,
        cwd: str,
        model: str,
        approved_retry: bool = False,
        conversation_id: str = "",
        full_auto: bool = False,
    ):
        """使用 AgentExecutor 执行真实 Agent CLI"""
        try:
            async for event in agent_executor.run_task(
                task_id=task_id,
                agent_id=agent_id,
                prompt=prompt,
                cwd=cwd,
                model=model,
                approved_retry=approved_retry,
                conversation_id=conversation_id,
                full_auto=full_auto,
            ):
                if event.type == "started":
                    await self._update_status(task_id, workspace_id, "running")
                elif event.type in ("output", "tool_output", "progress"):
                    await self._append_result_chunk(task_id, event.content)
                    # 推送实时输出到 WebSocket
                    await event_emitter.emit_task_output(
                        task_id, workspace_id, event.content, event.type
                    )
                elif event.type == "completed":
                    await self._finish_with_result(
                        task_id, workspace_id, "completed", event.content
                    )
                elif event.type == "failed":
                    await self._finish_with_result(
                        task_id, workspace_id, "failed", event.content
                    )
                elif event.type == "cancelled":
                    await self._finish_with_result(
                        task_id, workspace_id, "stopped", "Cancelled"
                    )
                elif event.type == "approval_request":
                    if approved_retry:
                        await self._finish_with_result(
                            task_id,
                            workspace_id,
                            "failed",
                            event.content or "Approval still required after approved retry.",
                        )
                        continue
                    await self._update_status(task_id, workspace_id, "review")
                    await event_emitter.emit_task_approval_request(
                        task_id, workspace_id, event.content
                    )
                    # 创建持久化审批记录
                    try:
                        from backend.services.approval_service import approval_service
                        task_data = await self.get_task(task_id)
                        await approval_service.create_approval(
                            task_id=task_id,
                            workspace_id=workspace_id,
                            approval_type="agent_permission",
                            detail={"reason": event.content or "Agent requires approval"},
                            chat_id=(task_data or {}).get("chat_id"),
                            plan_id=None,
                        )
                    except Exception:
                        logger.debug("create_approval failed", exc_info=True)
                elif event.type == "session_id":
                    # 保存 session_id 到任务数据库
                    async with async_session_factory() as session:
                        await session.execute(
                            text("UPDATE tasks SET session_id = :sid WHERE id = :tid"),
                            {"sid": event.session_id, "tid": task_id},
                        )
                        await session.commit()
                    # 同步到 conversation
                    if conversation_id:
                        from backend.services.conversation_service import conversation_service
                        await conversation_service.update_session(conversation_id, event.session_id)
        except asyncio.CancelledError:
            await agent_executor.cancel_task(task_id)
            await self._update_status(
                task_id, workspace_id, "stopped", result="Cancelled by user"
            )
        except Exception as exc:
            logger.exception("Agent execution failed for %s", self._short_id(task_id))
            await self._update_status(
                task_id, workspace_id, "failed", result=f"Error: {exc}"
            )
        finally:
            with LOCK:
                TASKS.pop(task_id, None)

    # ── list ─────────────────────────────────────────────

    async def list_tasks(
        self,
        workspace_id: str = "default",
        status: Optional[str] = None,
        agent_id: Optional[str] = None,
        chat_id: Optional[str] = None,
        project: Optional[str] = None,
        session_id: Optional[str] = None,
        created_after: Optional[str] = None,
        created_before: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """任务列表：筛选 + 分页"""
        conditions = ["workspace_id = :workspace_id"]
        params: dict = {"workspace_id": workspace_id}

        if status:
            conditions.append("status = :status")
            params["status"] = status
        if agent_id:
            conditions.append("agent_id = :agent_id")
            params["agent_id"] = agent_id
        if chat_id:
            conditions.append("chat_id = :chat_id")
            params["chat_id"] = chat_id
        if project:
            conditions.append("(cwd = :project OR cwd LIKE :project_prefix)")
            params["project"] = project
            params["project_prefix"] = project.rstrip("/") + "/%"
        if session_id:
            conditions.append("session_id = :session_id")
            params["session_id"] = session_id
        if created_after:
            conditions.append("created_at >= :created_after")
            params["created_after"] = created_after
        if created_before:
            conditions.append("created_at <= :created_before")
            params["created_before"] = created_before

        where = " AND ".join(conditions)

        async with async_session_factory() as session:
            # total count
            count_result = await session.execute(
                text(f"SELECT COUNT(*) FROM tasks WHERE {where}"),
                params,
            )
            total = count_result.scalar() or 0

            # paginated rows
            offset = (page - 1) * page_size
            params["page_size"] = page_size
            params["offset"] = offset
            result = await session.execute(
                text(f"""
                SELECT id, workspace_id, plan_id, assignee_id, assignee_type,
                       chat_id, parent_task_id, prompt, cwd, model, agent_id,
                       session_id, status, result, attachments, output_path, worktree_path,
                       branch_name, diff_summary, test_result, priority, labels,
                       created_at, started_at, completed_at, duration_ms
                FROM tasks
                WHERE {where}
                ORDER BY created_at DESC
                LIMIT :page_size OFFSET :offset
                """),
                params,
            )
            rows = result.fetchall()
            items = [dict(row._mapping) for row in rows]

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    # ── get ──────────────────────────────────────────────

    async def get_task(self, task_id: str) -> Optional[dict]:
        """任务详情"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, workspace_id, plan_id, assignee_id, assignee_type,
                       chat_id, parent_task_id, prompt, cwd, model, agent_id,
                       session_id, status, result, attachments, output_path, worktree_path,
                       branch_name, diff_summary, test_result, priority, labels,
                       created_at, started_at, completed_at, duration_ms
                FROM tasks WHERE id = :task_id
                """),
                {"task_id": task_id},
            )
            row = result.fetchone()
            if not row:
                return None
            return dict(row._mapping)

    # ── stop ─────────────────────────────────────────────

    async def stop_task(self, task_id: str) -> Optional[dict]:
        """停止任务（同时终止真实 Agent 进程）"""
        task = await self.get_task(task_id)
        if not task:
            return None
        if task["status"] not in ("queued", "running", "review"):
            return task  # already in terminal state

        # 尝试通过 AgentExecutor 终止真实进程
        await agent_executor.cancel_task(task_id)

        # set cancel flag on runtime
        with LOCK:
            runtime = TASKS.get(task_id)
            if runtime:
                runtime.cancel_requested = True
                runtime.stop_requested = True
                # kill process if exists (legacy subprocess.Popen)
                if runtime.process and runtime.process.poll() is None:
                    try:
                        runtime.process.terminate()
                    except Exception:
                        pass

        await self._update_status(
            task_id, task["workspace_id"], "stopped",
            result="Task stopped by user.",
        )
        return await self.get_task(task_id)

    # ── approve ──────────────────────────────────────────

    async def approve_task(self, task_id: str) -> Optional[dict]:
        """批准审批"""
        task = await self.get_task(task_id)
        if not task:
            return None
        if task["status"] != "review":
            return task

        old_status = task["status"]
        await event_emitter.emit_approval_resolved(
            task_id, task["workspace_id"], task_id, "approved",
        )

        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE tasks
                SET status = 'queued',
                    started_at = NULL,
                    completed_at = NULL,
                    duration_ms = NULL
                WHERE id = :task_id
                """),
                {"task_id": task_id},
            )
            await session.commit()

        with LOCK:
            runtime = TASKS.get(task_id)
            if runtime:
                runtime.status = "queued"

        await event_emitter.emit_task_status_changed(
            task_id, task["workspace_id"], old_status, "queued",
        )

        agent_id = task.get("agent_id") or "codex"
        cwd = task.get("cwd") or str(Path.cwd())
        model = task.get("model") or ""
        prompt = task["prompt"]

        runtime = CodexTaskRuntime(
            task_id=task_id,
            chat_id=task.get("chat_id") or "",
            cwd=Path(cwd),
            prompt=prompt,
            agent_id=agent_id,
            model=model,
            status="queued",
            approved_retry=True,
        )
        with LOCK:
            TASKS[task_id] = runtime

        self._schedule_agent_start(
            task_id,
            task["workspace_id"],
            agent_id,
            prompt,
            cwd,
            model,
            approved_retry=True,
        )
        return await self.get_task(task_id)

    # ── reject ───────────────────────────────────────────

    async def reject_task(self, task_id: str, reason: str = "") -> Optional[dict]:
        """拒绝审批"""
        task = await self.get_task(task_id)
        if not task:
            return None
        if task["status"] != "review":
            return task

        old_status = task["status"]
        # emit approval resolved event
        await event_emitter.emit_approval_resolved(
            task_id, task["workspace_id"], task_id, "rejected",
        )
        await self._update_status(
            task_id, task["workspace_id"], "rejected", old_status=old_status,
            result=reason or "Task rejected by user.",
        )
        return await self.get_task(task_id)

    # ── retry ────────────────────────────────────────────

    async def retry_task(self, task_id: str) -> Optional[dict]:
        """重试失败任务"""
        task = await self.get_task(task_id)
        if not task:
            return None
        if task["status"] not in ("failed", "stopped", "rejected"):
            return task

        old_status = task["status"]
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE tasks
                SET status = 'queued',
                    result = NULL,
                    started_at = NULL,
                    completed_at = NULL,
                    duration_ms = NULL
                WHERE id = :task_id
                """),
                {"task_id": task_id},
            )
            await session.commit()

        await event_emitter.emit_task_status_changed(
            task_id, task["workspace_id"], old_status, "queued",
        )

        agent_id = task.get("agent_id") or "codex"
        cwd = task.get("cwd") or str(Path.cwd())
        model = task.get("model") or ""
        prompt = task["prompt"]

        # re-register in memory
        runtime = CodexTaskRuntime(
            task_id=task_id,
            chat_id=task.get("chat_id") or "",
            cwd=Path(cwd),
            prompt=prompt,
            agent_id=agent_id,
            model=model,
            status="queued",
        )
        with LOCK:
            TASKS[task_id] = runtime

        self._schedule_agent_start(task_id, task["workspace_id"], agent_id, prompt, cwd, model)

        return await self.get_task(task_id)


    # ── startup recovery ──────────────────────────────

    async def recover_orphaned_tasks(self) -> int:
        """服务重启时将残留的 running/queued 状态任务标记为 failed。

        服务器重启后，内存中的 TASKS 字典为空，但 DB 中可能残留
        status='running' 或 'queued' 的任务（进程已丢失）。
        将它们标记为 failed 以保持 Dashboard 统计与 Agent 状态一致。
        """
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, workspace_id FROM tasks"
                    " WHERE status IN ('running', 'queued')"
                ),
            )
            orphaned = result.fetchall()
            if not orphaned:
                return 0

            now = self._now_iso()
            await session.execute(
                text(
                    "UPDATE tasks SET status = 'failed',"
                    " result = COALESCE(result || char(10), '') || :reason,"
                    " completed_at = :now"
                    " WHERE status IN ('running', 'queued')"
                ),
                {"reason": "[auto-recovery] Task interrupted by server restart.", "now": now},
            )
            await session.commit()

        logger.info(
            "Recovered %d orphaned task(s) to 'failed' status.",
            len(orphaned),
        )
        return len(orphaned)


task_service = TaskService()
