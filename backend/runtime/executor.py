"""
AgentExecutor: 异步 Agent CLI 执行器

使用 asyncio.create_subprocess_exec 运行 Agent CLI，
逐行读取 stdout JSON 事件流，解析为 TaskEvent 输出。
"""
import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncGenerator, Optional

from backend.runtime.adapters import AGENT_ADAPTERS, approved_permission_mode, should_create_approval
from backend.runtime.config import APPROVED_CODEX_APPROVAL_POLICY, APPROVED_CODEX_SANDBOX_MODE
from backend.runtime.task_runtime import CodexTaskRuntime

logger = logging.getLogger("tide.executor")


@dataclass
class TaskEvent:
    """Agent 执行过程中的事件。"""

    type: str  # started | output | tool_output | progress | completed | failed | cancelled | session_id | approval_request
    content: str = ""
    session_id: str = ""
    metadata: dict = field(default_factory=dict)


class AgentExecutor:
    """异步 Agent CLI 执行器。"""

    def __init__(self) -> None:
        self._processes: dict[str, asyncio.subprocess.Process] = {}

    @staticmethod
    def _is_resume_error(output: str) -> bool:
        """判断输出是否为 resume 失败的错误（session/thread 不存在或不可达）。

        覆盖 Codex、Claude、Qoder 三种 CLI 的 resume 失败格式：
        - Codex: "no rollout found", "thread/resume failed"
        - Claude: "No conversation found with session ID"
        - 通用: "not logged in"（通过 CC Switch 代理时 resume 无效 session 可能返回此错误）
        """
        if not output:
            return False
        haystack = output.lower()
        resume_error_signals = (
            "no rollout found",
            "thread/resume failed",
            "thread/resume:",
            "no previous sessions found",
            "error resuming session",
            "no conversation found",
            "session not found",
            "not logged in",
            "please run /login",
        )
        return any(signal in haystack for signal in resume_error_signals)

    async def run_task(
        self,
        task_id: str,
        agent_id: str,
        prompt: str,
        cwd: str,
        model: str = "",
        approved_retry: bool = False,
        conversation_id: str = "",
        session_id: str = "",
        full_auto: bool = False,
    ) -> AsyncGenerator[TaskEvent, None]:
        """执行 Agent CLI 并流式产出事件。

        1. 通过适配器构建命令；
        2. asyncio.create_subprocess_exec 启动子进程；
        3. 逐行读 stdout，由适配器 parse_events 解析；
        4. 进程结束后产出 completed/failed 事件。
        5. 若 resume 失败（thread 不存在），自动降级为新建会话重试。
        """
        adapter = AGENT_ADAPTERS.get(agent_id) or AGENT_ADAPTERS["codex"]

        runtime = CodexTaskRuntime(
            task_id=task_id,
            chat_id="",
            cwd=Path(cwd),
            prompt=prompt,
            agent_id=agent_id or "codex",
            model=model,
            approved_retry=approved_retry,
            conversation_id=conversation_id,
            session_id=session_id,
        )
        if full_auto:
            if adapter.id == "codex":
                runtime.approval_policy = "full-auto"
                runtime.sandbox_mode = "off"
            else:
                runtime.permission_mode = "bypass_permissions"
        elif approved_retry:
            if adapter.id == "codex":
                runtime.approval_policy = APPROVED_CODEX_APPROVAL_POLICY
                runtime.sandbox_mode = APPROVED_CODEX_SANDBOX_MODE
            else:
                runtime.permission_mode = approved_permission_mode(adapter.id)

        try:
            command = adapter.build_command(runtime)
        except Exception as e:  # noqa: BLE001
            yield TaskEvent(
                type="failed",
                content=f"Failed to build command: {type(e).__name__}: {e}",
            )
            return

        # 记录是否使用了 resume，以便失败时降级
        used_resume = runtime.session_id and any("resume" in arg for arg in command)

        logger.info("[executor] task=%s agent=%s cmd=%s", task_id, adapter.id, command)
        yield TaskEvent(type="started", metadata={"command": list(command)})

        proc: Optional[asyncio.subprocess.Process] = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                cwd=cwd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                limit=16 * 1024 * 1024,  # 16MB — Agent CLI 单行 JSON 可能很大
            )
            self._processes[task_id] = proc

            session_id = ""
            output_parts: list[str] = []
            approval_requested = False

            assert proc.stdout is not None
            while True:
                line_bytes = await proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\n")
                if not line:
                    continue

                try:
                    events = adapter.parse_events(line)
                except Exception as e:  # noqa: BLE001
                    logger.warning("[executor] parse_events error: %s; line=%r", e, line[:200])
                    events = [("text", line)]

                for event_type, content in events:
                    if event_type == "skip":
                        continue
                    if event_type == "session_id":
                        session_id = content or session_id
                        yield TaskEvent(type="session_id", session_id=content)
                    elif event_type != "approval_request" and should_create_approval(content):
                        if content:
                            output_parts.append(content)
                        approval_requested = True
                        yield TaskEvent(type="approval_request", content=content, session_id=session_id)
                        if proc.returncode is None:
                            try:
                                proc.terminate()
                            except ProcessLookupError:
                                pass
                        break
                    elif event_type == "complete":
                        if content:
                            output_parts.append(content)
                        yield TaskEvent(type="output", content=content, session_id=session_id)
                    elif event_type == "message":
                        if content:
                            output_parts.append(content)
                        yield TaskEvent(type="output", content=content, session_id=session_id)
                    elif event_type == "tool_output":
                        if content:
                            output_parts.append(content)
                        yield TaskEvent(type="tool_output", content=content, session_id=session_id)
                    elif event_type == "progress":
                        yield TaskEvent(type="progress", content=content, session_id=session_id)
                    elif event_type == "approval_request":
                        yield TaskEvent(type="approval_request", content=content, session_id=session_id)
                    else:
                        if content:
                            output_parts.append(content)
                            yield TaskEvent(type="output", content=content, session_id=session_id)
                if approval_requested:
                    break

            return_code = await proc.wait()
            if approval_requested:
                return

            final_output = "\n".join(p for p in output_parts[-5:] if p) if output_parts else ""

            # --- Resume 失败降级：检测 thread 不存在错误，自动降级为新建会话 ---
            if return_code != 0 and used_resume and self._is_resume_error(final_output):
                logger.warning(
                    "[executor] task=%s resume failed (thread not found), "
                    "falling back to new session. error: %s",
                    task_id, final_output[:200],
                )
                yield TaskEvent(
                    type="progress",
                    content="Resume 失败，正在降级为新建会话...",
                    session_id=session_id,
                )
                # 清除 session_id 使 adapter 构建不带 resume 的命令
                runtime.session_id = ""
                runtime.conversation_id = ""
                try:
                    fallback_command = adapter.build_command(runtime)
                except Exception as e:  # noqa: BLE001
                    yield TaskEvent(
                        type="failed",
                        content=f"Resume fallback: failed to build command: {type(e).__name__}: {e}",
                    )
                    return

                logger.info("[executor] task=%s fallback cmd=%s", task_id, fallback_command)

                proc = await asyncio.create_subprocess_exec(
                    *fallback_command,
                    cwd=cwd,
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    limit=16 * 1024 * 1024,
                )
                self._processes[task_id] = proc

                session_id = ""
                output_parts = []
                approval_requested = False

                assert proc.stdout is not None
                while True:
                    line_bytes = await proc.stdout.readline()
                    if not line_bytes:
                        break
                    line = line_bytes.decode("utf-8", errors="replace").rstrip("\n")
                    if not line:
                        continue

                    try:
                        events = adapter.parse_events(line)
                    except Exception as e:  # noqa: BLE001
                        logger.warning("[executor] parse_events error: %s; line=%r", e, line[:200])
                        events = [("text", line)]

                    for event_type, content in events:
                        if event_type == "skip":
                            continue
                        if event_type == "session_id":
                            session_id = content or session_id
                            yield TaskEvent(type="session_id", session_id=content)
                        elif event_type != "approval_request" and should_create_approval(content):
                            if content:
                                output_parts.append(content)
                            approval_requested = True
                            yield TaskEvent(type="approval_request", content=content, session_id=session_id)
                            if proc.returncode is None:
                                try:
                                    proc.terminate()
                                except ProcessLookupError:
                                    pass
                            break
                        elif event_type == "complete":
                            if content:
                                output_parts.append(content)
                            yield TaskEvent(type="output", content=content, session_id=session_id)
                        elif event_type == "message":
                            if content:
                                output_parts.append(content)
                            yield TaskEvent(type="output", content=content, session_id=session_id)
                        elif event_type == "tool_output":
                            yield TaskEvent(type="tool_output", content=content, session_id=session_id)
                        elif event_type == "progress":
                            yield TaskEvent(type="progress", content=content, session_id=session_id)
                        elif event_type == "approval_request":
                            yield TaskEvent(type="approval_request", content=content, session_id=session_id)
                        else:
                            if content:
                                output_parts.append(content)
                                yield TaskEvent(type="output", content=content, session_id=session_id)
                    if approval_requested:
                        break

                return_code = await proc.wait()
                if approval_requested:
                    return

                final_output = "\n".join(p for p in output_parts[-5:] if p) if output_parts else ""
            # --- End resume fallback ---

            if return_code == 0:
                yield TaskEvent(
                    type="completed",
                    content=final_output,
                    session_id=session_id,
                    metadata={"return_code": 0},
                )
            else:
                yield TaskEvent(
                    type="failed",
                    content=final_output or f"Process exited with code {return_code}",
                    session_id=session_id,
                    metadata={"return_code": return_code},
                )

        except asyncio.CancelledError:
            yield TaskEvent(type="cancelled", content="Task was cancelled")
            raise
        except FileNotFoundError as e:
            yield TaskEvent(
                type="failed",
                content=f"Agent CLI not found: {e}. Make sure {adapter.bin_name} is in PATH.",
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("[executor] task=%s execution error", task_id)
            yield TaskEvent(
                type="failed",
                content=f"Execution error: {type(e).__name__}: {e}",
            )
        finally:
            self._processes.pop(task_id, None)

    async def cancel_task(self, task_id: str) -> bool:
        """取消正在执行的任务，返回是否真的发出了取消信号。"""
        proc = self._processes.get(task_id)
        if proc is None or proc.returncode is not None:
            return False
        try:
            proc.terminate()
        except ProcessLookupError:
            return False
        try:
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        return True

    def is_running(self, task_id: str) -> bool:
        proc = self._processes.get(task_id)
        return proc is not None and proc.returncode is None


# 全局单例
agent_executor = AgentExecutor()
