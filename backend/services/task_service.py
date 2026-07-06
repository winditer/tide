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
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.event_emitter import event_emitter
from backend.services.hook_engine import hook_engine
from backend.services.ws_hub import ws_hub
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
            if new_status in ("completed", "failed", "stopped", "rejected", "cancelled", "committed", "merged"):
                sets.append("completed_at = :completed_at")
                params["completed_at"] = self._now_iso()
                # 确保 started_at 有值，避免只有 completed_at 而无 started_at
                sets.append(
                    "started_at = CASE WHEN started_at IS NULL THEN "
                    "COALESCE(created_at, :fallback_started) ELSE started_at END"
                )
                params["fallback_started"] = self._now_iso()
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

        # 触发 Hooks（异步非阻塞，失败不影响主流程）
        hook_event = None
        if new_status == "running":
            hook_event = "task.started"
        elif new_status == "completed":
            hook_event = "task.completed"
        elif new_status == "failed":
            hook_event = "task.failed"
        if hook_event:
            try:
                task_row = await self.get_task(task_id)
                output_text = str((task_row or {}).get("result") or "")
                # 从任务 cwd 派生 project_id
                _cwd = (task_row or {}).get("cwd") or ""
                _project_id = None
                if _cwd:
                    from backend.core.dependencies import encode_project_id
                    _project_id = encode_project_id(_cwd) or None
                payload = {
                    "event": hook_event,
                    "task_id": task_id,
                    "agent_id": (task_row or {}).get("agent_id"),
                    "status": new_status,
                    "output": output_text,
                }
                asyncio.create_task(
                    hook_engine.trigger(hook_event, workspace_id, payload, project_id=_project_id)
                )
            except Exception:
                logger.debug("hook trigger dispatch failed", exc_info=True)

        # 任务进入终态时清理残留的 pending 审批记录
        if new_status in ("completed", "failed", "stopped", "rejected", "committed", "merged"):
            try:
                from backend.services.approval_service import approval_service
                await approval_service.cleanup_task_approvals(task_id)
            except Exception as e:
                logger.debug("cleanup_task_approvals failed: %s", e)

        # 事件驱动通知 work_item_service：仅 completed 时推进工作流。
        # failed/stopped/rejected 不推进，工作项停留在当前节点等待重试或人工介入。
        if new_status == "completed":
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
        elif new_status in ("failed", "stopped", "rejected"):
            logger.warning(
                "Task %s ended with status=%s, work item will NOT advance",
                self._short_id(task_id), new_status,
            )

        # 任务完成时解析产物并推送 task.artifact 事件到 WS（异步、非阻塞）
        if new_status == "completed":
            try:
                task_row = await self.get_task(task_id)
                sid = str((task_row or {}).get("session_id") or "")
                final_result = result
                if final_result is None:
                    final_result = str((task_row or {}).get("result") or "")
                if sid and final_result:
                    asyncio.create_task(
                        self._emit_artifacts_event(task_id, sid, final_result)
                    )
            except Exception:
                logger.debug(
                    "emit task.artifact dispatch failed for task=%s",
                    self._short_id(task_id),
                    exc_info=True,
                )

    # ── artifacts ────────────────────────────────────────

    @staticmethod
    def _infer_artifact_type(target: str) -> str:
        """根据 URL/路径推断产物类型：markdown / file / link。"""
        if not target:
            return "file"
        lower = target.lower().split("#", 1)[0].split("?", 1)[0]
        if lower.startswith(("http://", "https://")):
            return "link"
        if lower.endswith((".md", ".markdown")):
            return "markdown"
        return "file"

    def _extract_artifacts_from_result(self, result: str) -> list[dict]:
        """从 task result 文本中提取产物信息。

        规则：
        1. Markdown 链接 ``[label](url)``：提取 label 与 url。
        2. ``File created successfully at: <path>`` / ``Created file: <path>`` /
           ``写入文件: <path>`` 等约定输出：提取生成文件路径。
        3. 排除代码块 ``` ``` 中的内容，避免命中示例代码。
        """
        if not result or not isinstance(result, str):
            return []

        # 排除三引号代码块，避免误匹配示例
        try:
            stripped = re.sub(r"```.*?```", "", result, flags=re.DOTALL)
        except re.error:
            stripped = result

        artifacts: list[dict] = []
        seen: set = set()

        # 1. Markdown 链接
        try:
            for label, url in re.findall(r"\[([^\]\n]+)\]\(([^)\s]+)\)", stripped):
                url = url.strip().strip("`'\"")
                label = label.strip()
                if not url or not label:
                    continue
                key = ("link", url)
                if key in seen:
                    continue
                seen.add(key)
                artifacts.append({
                    "label": label,
                    "url": url,
                    "type": self._infer_artifact_type(url),
                })
        except re.error:
            pass

        # 2. 创建文件提示行
        path_patterns = [
            r"File created successfully at:\s*(.+?)(?:\n|$)",
            r"Created file:\s*(.+?)(?:\n|$)",
            r"写入文件[:：]\s*(.+?)(?:\n|$)",
        ]
        for pattern in path_patterns:
            try:
                matches = re.findall(pattern, stripped)
            except re.error:
                matches = []
            for raw in matches:
                path = (raw or "").strip().strip("`'\"")
                if not path:
                    continue
                key = ("path", path)
                if key in seen:
                    continue
                seen.add(key)
                label = path.rsplit("/", 1)[-1] or path
                artifacts.append({
                    "label": label,
                    "url": path,
                    "type": self._infer_artifact_type(path),
                })

        return artifacts

    async def _emit_artifacts_event(
        self,
        task_id: str,
        session_id: str,
        result: str,
    ) -> None:
        """解析 task result 中的产物信息并通过 WebSocket 推送 ``task.artifact`` 事件。"""
        if not session_id:
            return
        try:
            extracted = self._extract_artifacts_from_result(result)
        except Exception:
            logger.debug(
                "_extract_artifacts_from_result failed for task=%s",
                self._short_id(task_id),
                exc_info=True,
            )
            return
        if not extracted:
            return

        artifacts: list[dict] = []
        for art in extracted:
            artifacts.append({
                "id": str(uuid.uuid4()),
                "label": art.get("label") or "",
                "url": art.get("url") or "",
                "type": art.get("type") or "file",
                "task_id": task_id,
            })

        event = {
            "type": "task.artifact",
            "task_id": task_id,
            "session_id": session_id,
            "artifacts": artifacts,
        }
        try:
            await ws_hub.broadcast(f"session:{session_id}", event)
            await ws_hub.broadcast(f"task:{task_id}", event)
            await ws_hub.broadcast("tasks", event)
        except Exception:
            logger.debug(
                "ws broadcast task.artifact failed for task=%s",
                self._short_id(task_id),
                exc_info=True,
            )
            return
        logger.info(
            "emit task.artifact task=%s session=%s count=%d",
            self._short_id(task_id), session_id, len(artifacts),
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
        group_id: Optional[str] = None,
    ) -> dict:
        """创建任务：写 DB + 启动真实 Agent CLI。"""
        task_id = str(uuid.uuid4())
        now = self._now_iso()

        # Fallback empty agent_id to default
        if not agent_id:
            agent_id = "codex"

        if agent_id not in AGENT_ADAPTERS:
            choices = ", ".join(sorted(AGENT_ADAPTERS))
            raise ValueError(f"Unsupported agent_id: {agent_id!r}. Available agents: {choices}")

        # 校验并规范化 model：'auto' 解析为真实模型名，无效 key 也回退为随机可用模型
        adapter = AGENT_ADAPTERS[agent_id]
        model = adapter.normalize_model(model)

        # 推断 DB 中记录的实际模型名：当 normalize 后为空或等于 agent_id 时，
        # 使用对应 Agent CLI 的环境变量默认模型，准确反映 CLI 实际运行的模型
        db_model = model
        if not db_model or db_model == agent_id:
            db_model = adapter.default_model or agent_id

        # fallback cwd
        if not cwd:
            cwd = str(Path.cwd())

        attachments_json = json.dumps(attachments or [], ensure_ascii=False)

        # 写入数据库
        async with async_session_factory() as session:
            await session.execute(
                text("""
                INSERT INTO tasks
                    (id, workspace_id, chat_id, session_id, prompt, agent_id, model, cwd, group_id, attachments, status, created_at)
                VALUES (:id, :workspace_id, :chat_id, :session_id, :prompt, :agent_id, :model, :cwd, :group_id, :attachments, 'queued', :created_at)
                """),
                {
                    "id": task_id,
                    "workspace_id": workspace_id,
                    "chat_id": chat_id,
                    "session_id": session_id or None,
                    "prompt": prompt,
                    "agent_id": agent_id,
                    "model": db_model or None,
                    "cwd": cwd,
                    "group_id": group_id or None,
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
            attachments=attachments or [],
        )
        with LOCK:
            TASKS[task_id] = runtime

        # emit task.created via event_emitter
        await event_emitter.emit_task_created(task_id, workspace_id)

        self._schedule_agent_start(task_id, workspace_id, agent_id, prompt, cwd, model,
                                    conversation_id=conversation_id or "",
                                    session_id=session_id or "",
                                    full_auto=full_auto,
                                    attachments=attachments)

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
        session_id: str = "",
        full_auto: bool = False,
        attachments: Optional[list[str]] = None,
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
                session_id=session_id,
                full_auto=full_auto,
                attachments=attachments,
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
        session_id: str = "",
        full_auto: bool = False,
        attachments: Optional[list[str]] = None,
    ):
        """使用 AgentExecutor 执行真实 Agent CLI"""
        # 单独跟踪 agent 的 "output" 类型事件（即 agent 的自然语言回复），
        # 与 "tool_output"、"progress" 区分开，用于下游节点获取 agent 最终结论。
        agent_output_chunks: list[str] = []

        # 守卫：执行前确认任务仍为活跃状态（防止 recover 后的异步任务竞争）
        async with async_session_factory() as _guard_session:
            _guard_result = await _guard_session.execute(
                text("SELECT status FROM tasks WHERE id = :tid"),
                {"tid": task_id},
            )
            _guard_row = _guard_result.fetchone()
            if not _guard_row or _guard_row[0] in ("cancelled", "completed", "failed", "stopped", "rejected", "committed", "merged"):
                logger.warning(
                    "[task_service] _run_agent_real aborted: task %s already in terminal state '%s'",
                    task_id[:8], (_guard_row[0] if _guard_row else "NOT_FOUND"),
                )
                return

        try:
            async for event in agent_executor.run_task(
                task_id=task_id,
                agent_id=agent_id,
                prompt=prompt,
                cwd=cwd,
                model=model,
                approved_retry=approved_retry,
                conversation_id=conversation_id,
                session_id=session_id,
                full_auto=full_auto,
                attachments=attachments,
            ):
                if event.type == "started":
                    await self._update_status(task_id, workspace_id, "running")
                elif event.type in ("output", "tool_output", "progress"):
                    await self._append_result_chunk(task_id, event.content)
                    # 推送实时输出到 WebSocket
                    await event_emitter.emit_task_output(
                        task_id, workspace_id, event.content, event.type
                    )
                    # 仅收集 agent 的自然语言回复（不含 tool_output/progress）
                    if event.type == "output" and event.content:
                        agent_output_chunks.append(event.content)
                    elif event.type == "tool_output":
                        # 工具执行后清空之前的 output 累积，
                        # 确保 agent_final_output 只保留最后一次工具调用之后的结论
                        agent_output_chunks.clear()
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
                    if full_auto:
                        logger.warning(
                            "[task_service] approval_request in full_auto mode ignored (not creating approval), task=%s",
                            task_id[:8],
                        )
                        # full_auto 模式下不创建审批记录，不中断执行；
                        # executor 已经终止了进程，后续事件流会产出 failed/completed。
                        continue
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
            # 将 agent 的自然语言回复单独存储到 agent_final_output 字段，
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

        # 解析任务附件
        attachments: list[str] = []
        try:
            raw_attachments = task.get("attachments")
            if raw_attachments:
                if isinstance(raw_attachments, str):
                    attachments = json.loads(raw_attachments) or []
                elif isinstance(raw_attachments, list):
                    attachments = raw_attachments
        except Exception:
            attachments = []

        # model 透传：DB 中已有非空 model 直接使用，仅为空时取默认值
        if not model:
            adapter = AGENT_ADAPTERS.get(agent_id)
            model = adapter.default_model if adapter else ""

        # 确保 model 不是 "auto" 字面量
        if model.strip().lower() == "auto":
            from backend.runtime.config import resolve_auto_model
            model = resolve_auto_model(model)

        # 判断是否为工作项关联任务：若是，必须以 full_auto 模式执行
        full_auto = await self._is_work_item_task(task_id)
        if full_auto:
            logger.info(
                "[task_service] approve_task: task=%s is work_item linked, using full_auto=True",
                self._short_id(task_id),
            )

        runtime = CodexTaskRuntime(
            task_id=task_id,
            chat_id=task.get("chat_id") or "",
            cwd=Path(cwd),
            prompt=prompt,
            agent_id=agent_id,
            model=model,
            status="queued",
            approved_retry=True,
            attachments=attachments,
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
            full_auto=full_auto,
            attachments=attachments,
        )
        return await self.get_task(task_id)

    # ── reject ───────────────────────────────────────────

    async def _is_work_item_task(self, task_id: str) -> bool:
        """检查任务是否关联到工作项或属于 Plan 子任务。

        工作项关联的任务和 Plan 子任务必须以 full_auto 模式执行，
        不允许出现审批中断。判断依据：
        1. work_item_transitions 表中有该 task_id 的记录
        2. tasks 表中该任务的 plan_id 不为空（即为 Plan 子任务）
        """
        try:
            async with async_session_factory() as session:
                # 检查是否关联工作项
                result = await session.execute(
                    text(
                        "SELECT 1 FROM work_item_transitions "
                        "WHERE task_id = :task_id LIMIT 1"
                    ),
                    {"task_id": task_id},
                )
                if result.fetchone() is not None:
                    return True
                # 检查是否为 Plan 子任务（plan_id 非空）
                result2 = await session.execute(
                    text(
                        "SELECT 1 FROM tasks "
                        "WHERE id = :task_id AND plan_id IS NOT NULL LIMIT 1"
                    ),
                    {"task_id": task_id},
                )
                return result2.fetchone() is not None
        except Exception:
            logger.debug("_is_work_item_task check failed for task=%s", self._short_id(task_id), exc_info=True)
            return False

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
        if task["status"] not in ("failed", "stopped", "rejected", "cancelled"):
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

        # 解析任务附件
        attachments: list[str] = []
        try:
            raw_attachments = task.get("attachments")
            if raw_attachments:
                if isinstance(raw_attachments, str):
                    attachments = json.loads(raw_attachments) or []
                elif isinstance(raw_attachments, list):
                    attachments = raw_attachments
        except Exception:
            attachments = []

        # model 透传：DB 中已有非空 model 直接使用，仅为空时取默认值
        if not model:
            adapter = AGENT_ADAPTERS.get(agent_id)
            model = adapter.default_model if adapter else ""

        # 确保 model 不是 "auto" 字面量
        if model.strip().lower() == "auto":
            from backend.runtime.config import resolve_auto_model
            model = resolve_auto_model(model)

        # 判断是否为工作项关联任务或 Plan 子任务：若是，必须以 full_auto 模式执行
        full_auto = await self._is_work_item_task(task_id)
        if full_auto:
            logger.info(
                "[task_service] retry_task: task=%s is work_item/plan linked, using full_auto=True",
                self._short_id(task_id),
            )

        # re-register in memory
        runtime = CodexTaskRuntime(
            task_id=task_id,
            chat_id=task.get("chat_id") or "",
            cwd=Path(cwd),
            prompt=prompt,
            agent_id=agent_id,
            model=model,
            status="queued",
            attachments=attachments,
        )
        with LOCK:
            TASKS[task_id] = runtime

        self._schedule_agent_start(
            task_id, task["workspace_id"], agent_id, prompt, cwd, model,
            approved_retry=True, full_auto=full_auto,
            attachments=attachments,
        )

        return await self.get_task(task_id)


    # ── startup recovery ──────────────────────────────

    async def recover_orphaned_tasks(self) -> int:
        """服务重启时将中断的任务标记为 cancelled"""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, workspace_id"
                    " FROM tasks WHERE status IN ('running', 'queued', 'review')"
                ),
            )
            orphaned = [dict(row._mapping) for row in result.fetchall()]
            if not orphaned:
                return 0

        now = self._now_iso()
        for task in orphaned:
            async with async_session_factory() as session:
                await session.execute(
                    text("""
                        UPDATE tasks SET
                            status = 'cancelled',
                            result = COALESCE(result || char(10), '') || '[auto-recovery] Task interrupted by server restart.',
                            completed_at = :now
                        WHERE id = :task_id
                    """),
                    {"task_id": task["id"], "now": now},
                )
                await session.commit()
            logger.info("[auto-recovery] Marked task %s as cancelled", task["id"])

        return len(orphaned)


task_service = TaskService()
