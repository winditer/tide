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

from backend.runtime.a2a_client import A2AAgentConfig
from backend.runtime.cli_env import build_subprocess_env
from backend.runtime.adapters import (
    AGENT_ADAPTERS,
    A2AAdapter,
    approved_permission_mode,
    should_create_approval,
    try_parse_claude_result,
    try_parse_token_usage,
)
from backend.runtime.config import APPROVED_CODEX_APPROVAL_POLICY, APPROVED_CODEX_SANDBOX_MODE, resolve_auto_model
from backend.runtime.task_runtime import CodexTaskRuntime

logger = logging.getLogger("tide.executor")


def _build_subprocess_env() -> dict[str, str]:
    """构建子进程环境变量：确保 Agent CLI 安装目录在 PATH 中。

    统一委托给 :mod:`backend.runtime.cli_env`，以便 executor、task_service 预检、
    智能路由等所有 CLI 执行路径共享同一套 PATH 增强逻辑。
    """
    return build_subprocess_env()


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

    async def _load_remote_agent_config(self, agent_id: str):
        """从数据库加载远程 Agent 配置。

        agent_id 形式为 ``a2a:<id>``或者直接传入 remote_agents.id。
        返回 :class:`A2AAgentConfig`；若未找到或不活跃则返回 None。
        """
        from backend.db.engine import async_session_factory
        from sqlalchemy import text

        lookup_id = agent_id[len("a2a:"):] if agent_id.startswith("a2a:") else agent_id

        async with async_session_factory() as session:
            result = await session.execute(
                text("SELECT * FROM remote_agents WHERE id = :id AND status = 'active'"),
                {"id": lookup_id},
            )
            row = result.mappings().first()
            if not row:
                return None

            return A2AAgentConfig(
                agent_id=row["id"],
                endpoint_url=row["endpoint_url"],
                auth_type=row["auth_type"] or "none",
                auth_credentials=row["auth_credentials"] or "",
                auth_header_name=row["auth_header_name"] or "",
                capabilities={
                    "streaming": bool(row["capabilities_streaming"]),
                    "pushNotifications": bool(row["capabilities_push_notifications"]),
                },
                timeout_ms=row["timeout_ms"] or 300000,
                max_retries=row["max_retries"] or 2,
                approval_required=bool(row["approval_required"]),
                approval_policy=row["approval_policy"] or "on-request",
                connection_mode=(row["connection_mode"] if "connection_mode" in row.keys() else "") or "http",
                daemon_session_id=(row["daemon_session_id"] if "daemon_session_id" in row.keys() else "") or "",
            )

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
        model: Optional[str] = "",
        approved_retry: bool = False,
        conversation_id: str = "",
        session_id: str = "",
        full_auto: bool = False,
        attachments: Optional[list[str]] = None,
    ) -> AsyncGenerator[TaskEvent, None]:
        """执行 Agent CLI 并流式产出事件。

        1. 通过适配器构建命令；
        2. asyncio.create_subprocess_exec 启动子进程；
        3. 逐行读 stdout，由适配器 parse_events 解析；
        4. 进程结束后产出 completed/failed 事件。
        5. 若 resume 失败（thread 不存在），自动降级为新建会话重试。
        6. 若 agent_id 以 ``a2a:`` 为前缀，路由到 :class:`A2AAdapter` 远程执行。
        """
        # ── 解析 "auto" 模型：避免将字面量 "auto" 传给 LLM API 网关 ──
        # 注意：Qoder CLI 不接受原始模型名（如 gpt-4o），"auto" 应清空让 CLI 使用自身配置
        if model and model.strip().lower() == "auto":
            adapter_for_model = AGENT_ADAPTERS.get(agent_id) or AGENT_ADAPTERS["codex"]
            if adapter_for_model.id == "qoder":
                # Qoder CLI 使用自身环境配置（极致模式），不传 --model
                model = ""
                logger.info("[executor] task=%s agent=qoder, clearing 'auto' model (CLI uses own config)", task_id)
            else:
                model = resolve_auto_model(model)
                logger.info("[executor] task=%s resolved model 'auto' → %r", task_id, model)
        # ── A2A 远程 Agent 路由 ──
        if agent_id and agent_id.startswith("a2a:"):
            async for ev in self._run_remote_a2a(
                task_id=task_id,
                agent_id=agent_id,
                prompt=prompt,
                cwd=cwd,
                model=model,
                conversation_id=conversation_id,
                session_id=session_id,
            ):
                yield ev
            return

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
            attachments=attachments or [],
        )
        if full_auto:
            if adapter.id == "codex":
                runtime.approval_policy = "never"
                runtime.sandbox_mode = "danger-full-access"
            elif adapter.id == "claude":
                runtime.permission_mode = "bypassPermissions"
            else:
                runtime.permission_mode = "bypass_permissions"
        elif approved_retry:
            if adapter.id == "codex":
                runtime.approval_policy = APPROVED_CODEX_APPROVAL_POLICY
                runtime.sandbox_mode = APPROVED_CODEX_SANDBOX_MODE
            else:
                runtime.permission_mode = approved_permission_mode(adapter.id)

        # 复制任务图片附件到 cwd 并在 prompt 中追加引用说明
        adapter.prepare_attachments(runtime)

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
                env=_build_subprocess_env(),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                limit=16 * 1024 * 1024,  # 16MB — Agent CLI 单行 JSON 可能很大
            )
            self._processes[task_id] = proc

            session_id = ""
            output_parts: list[str] = []
            approval_requested = False
            token_input_total = 0
            token_output_total = 0
            # Claude CLI 的 result 事件会载明精确的成本与 token，优先使用
            claude_cost_usd: float = 0.0
            claude_token_input = 0
            claude_token_output = 0
            # 当带 resume 启动时，先缓冲流式输出。若 resume 失败需要降级为新建会话，
            # 这些 error 输出会被丢弃，不进入聊天历史；resume 成功或非 resume 错误则正常 flush。
            buffer_output = bool(used_resume)
            buffered_events: list[TaskEvent] = []

            assert proc.stdout is not None
            line_count = 0
            while True:
                line_bytes = await proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\n")
                if not line:
                    continue

                line_count += 1
                if line_count % 50 == 0:
                    await asyncio.sleep(0)  # 显式让出事件循环，避免饿死其他协程

                # 尝试从 JSON 行中提取 token 使用量（失败返回 0,0，不影响主流程）
                try:
                    ti, to = try_parse_token_usage(line)
                    if ti or to:
                        token_input_total += ti
                        token_output_total += to
                except Exception as _e:  # noqa: BLE001
                    logger.debug("[executor] token parse error: %s", _e)

                # Claude CLI 的 result 事件携带精确的成本和含 cache 的 token 总量，
                # 优先使用这个数据；其他 CLI 该函数返回全 0，不会覆盖通用解析。
                try:
                    cc, ci, co = try_parse_claude_result(line)
                    if cc > 0 or ci > 0 or co > 0:
                        claude_cost_usd = cc
                        claude_token_input = ci
                        claude_token_output = co
                except Exception as _e:  # noqa: BLE001
                    logger.debug("[executor] claude result parse error: %s", _e)

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
                    elif not full_auto and event_type != "approval_request" and should_create_approval(content):
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
                        ev = TaskEvent(type="output", content=content, session_id=session_id)
                        if buffer_output:
                            buffered_events.append(ev)
                        else:
                            yield ev
                    elif event_type == "message":
                        if content:
                            output_parts.append(content)
                        ev = TaskEvent(type="output", content=content, session_id=session_id)
                        if buffer_output:
                            buffered_events.append(ev)
                        else:
                            yield ev
                    elif event_type == "tool_output":
                        if content:
                            output_parts.append(content)
                        ev = TaskEvent(type="tool_output", content=content, session_id=session_id)
                        if buffer_output:
                            buffered_events.append(ev)
                        else:
                            yield ev
                    elif event_type == "progress":
                        ev = TaskEvent(type="progress", content=content, session_id=session_id)
                        if buffer_output:
                            buffered_events.append(ev)
                        else:
                            yield ev
                    elif event_type == "approval_request":
                        if full_auto:
                            logger.warning("[executor] ignoring approval_request in full_auto mode, task=%s", task_id[:8])
                            continue
                        yield TaskEvent(type="approval_request", content=content, session_id=session_id)
                    else:
                        if content:
                            output_parts.append(content)
                            ev = TaskEvent(type="output", content=content, session_id=session_id)
                            if buffer_output:
                                buffered_events.append(ev)
                            else:
                                yield ev
                if approval_requested:
                    break

            return_code = await proc.wait()
            if approval_requested:
                # 进入审批流程时 flush 缓冲事件，保留上下文。
                for ev in buffered_events:
                    yield ev
                buffered_events = []
                return

            final_output = "\n".join(p for p in output_parts[-5:] if p) if output_parts else ""

            # --- Resume 失败降级：检测 thread 不存在错误，自动降级为新建会话 ---
            if return_code != 0 and used_resume and self._is_resume_error(final_output):
                logger.warning(
                    "[executor] task=%s resume failed (thread not found), "
                    "falling back to new session. error: %s",
                    task_id, final_output[:200],
                )
                # 静默降级：丢弃 resume 阶段缓冲的 error 输出，避免污染聊天历史。
                # 仅记录到日志，不再向前端推送 "Resume 失败..." 通知。
                buffered_events = []
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
                    env=_build_subprocess_env(),
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    limit=16 * 1024 * 1024,
                )
                self._processes[task_id] = proc

                session_id = ""
                output_parts = []
                approval_requested = False
                # 降级重试后重新计数 token 使用量（丢弃 resume 失败阶段误计的值）
                token_input_total = 0
                token_output_total = 0
                claude_cost_usd = 0.0
                claude_token_input = 0
                claude_token_output = 0

                assert proc.stdout is not None
                line_count = 0
                while True:
                    line_bytes = await proc.stdout.readline()
                    if not line_bytes:
                        break
                    line = line_bytes.decode("utf-8", errors="replace").rstrip("\n")
                    if not line:
                        continue

                    line_count += 1
                    if line_count % 50 == 0:
                        await asyncio.sleep(0)  # 显式让出事件循环，避免饿死其他协程

                    try:
                        ti, to = try_parse_token_usage(line)
                        if ti or to:
                            token_input_total += ti
                            token_output_total += to
                    except Exception as _e:  # noqa: BLE001
                        logger.debug("[executor] token parse error: %s", _e)

                    try:
                        cc, ci, co = try_parse_claude_result(line)
                        if cc > 0 or ci > 0 or co > 0:
                            claude_cost_usd = cc
                            claude_token_input = ci
                            claude_token_output = co
                    except Exception as _e:  # noqa: BLE001
                        logger.debug("[executor] claude result parse error: %s", _e)

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
                        elif not full_auto and event_type != "approval_request" and should_create_approval(content):
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
                            if full_auto:
                                logger.warning("[executor] ignoring approval_request in full_auto fallback, task=%s", task_id[:8])
                                continue
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
            else:
                # 未触发 resume 降级（resume 成功或非 resume 错误）：
                # 将初始阶段缓冲的事件按顺序 flush 给前端。
                for ev in buffered_events:
                    yield ev
                buffered_events = []

            # 任务结束（无论成败）均尝试写入 token 成本。
            # 失败任务的 token 消耗仍应被记录，仅在解析不到有效 token 时跳过。
            cost_model = model or adapter.default_model or adapter.id or "codex"
            logger.info(
                "[executor] task=%s cost_model=%s (model=%r, adapter.default_model=%r, adapter.id=%r)",
                task_id, cost_model, model, adapter.default_model, adapter.id,
            )
            try:
                # 确定最终使用的 token 数值：
                # 1) Claude/Qoder CLI result 事件的精确 token（含 cache）
                # 2) 通用 JSON 解析累计的 token
                # 3) tiktoken 估算降级
                final_input_tokens = 0
                final_output_tokens = 0
                reported_cost: Optional[float] = None

                if claude_token_input > 0 or claude_token_output > 0:
                    # Claude CLI result 事件提供了精确 token（含 cache 部分）
                    final_input_tokens = claude_token_input
                    final_output_tokens = claude_token_output
                    if claude_cost_usd > 0:
                        reported_cost = claude_cost_usd
                elif token_input_total > 0 or token_output_total > 0:
                    # 通用 JSON 解析路径
                    final_input_tokens = token_input_total
                    final_output_tokens = token_output_total

                # 当 CLI 没有提供有效 token 时，使用 tiktoken 估算。
                # 这涵盖：Qoder CLI token=0 bug、Codex CLI 不带 token 的情况。
                if final_input_tokens == 0 and final_output_tokens == 0:
                    from backend.runtime.adapters import estimate_token_count

                    final_input_tokens = estimate_token_count(prompt)
                    final_output_tokens = (
                        estimate_token_count("\n".join(p for p in output_parts if p))
                        if output_parts
                        else 0
                    )
                    # 如果 CLI 上报了成本但未提供 token，仍使用上报成本
                    if claude_cost_usd > 0:
                        reported_cost = claude_cost_usd
                    if final_input_tokens > 0 or final_output_tokens > 0:
                        logger.info(
                            "[executor] task=%s token estimated: in=%d out=%d",
                            task_id, final_input_tokens, final_output_tokens,
                        )

                token_input_total = final_input_tokens
                token_output_total = final_output_tokens

                if final_input_tokens > 0 or final_output_tokens > 0 or (reported_cost and reported_cost > 0):
                    from backend.services.cost_service import cost_service
                    await cost_service.update_task_cost(
                        task_id=task_id,
                        input_tokens=final_input_tokens,
                        output_tokens=final_output_tokens,
                        model=cost_model,
                        reported_cost_usd=reported_cost,
                    )
            except Exception as _e:  # noqa: BLE001
                logger.warning("[executor] update_task_cost failed task=%s: %s", task_id, _e)

            if return_code == 0:
                yield TaskEvent(
                    type="completed",
                    content=final_output,
                    session_id=session_id,
                    metadata={
                        "return_code": 0,
                        "token_input": token_input_total,
                        "token_output": token_output_total,
                    },
                )
            else:
                yield TaskEvent(
                    type="failed",
                    content=final_output or f"Process exited with code {return_code}",
                    session_id=session_id,
                    metadata={
                        "return_code": return_code,
                        "token_input": token_input_total,
                        "token_output": token_output_total,
                    },
                )

        except asyncio.CancelledError:
            yield TaskEvent(type="cancelled", content="Task was cancelled")
            raise
        except FileNotFoundError as e:
            # 区分「工作目录不存在」与「CLI 二进制文件找不到」：
            # worktree 在工作项合并后被清理时，cwd 指向的目录已不存在，
            # asyncio 子进程会抛出 FileNotFoundError，不应误报为 CLI 缺失。
            if cwd and not Path(cwd).is_dir():
                content = (
                    f"工作目录不存在: {cwd}。工作区可能已被清理，"
                    "请指定新的工作目录或在项目根目录重试。"
                )
            else:
                content = (
                    f"Agent CLI not found: {e}. "
                    f"Make sure {getattr(adapter, 'bin_name', 'agent')} is in PATH."
                )
            yield TaskEvent(type="failed", content=content)
        except Exception as e:  # noqa: BLE001
            logger.exception("[executor] task=%s execution error", task_id)
            yield TaskEvent(
                type="failed",
                content=f"Execution error: {type(e).__name__}: {e}",
            )
        finally:
            self._processes.pop(task_id, None)

    async def _run_remote_a2a(
        self,
        task_id: str,
        agent_id: str,
        prompt: str,
        cwd: str,
        model: str = "",
        conversation_id: str = "",
        session_id: str = "",
    ) -> AsyncGenerator[TaskEvent, None]:
        """远程 A2A Agent 执行分支，将 :class:`A2AAdapter` 产出的 dict 事件
        映射为 :class:`TaskEvent`。不使用本地子进程，也不参与 resume 降级。
        """
        config = await self._load_remote_agent_config(agent_id)
        if not config:
            yield TaskEvent(
                type="failed",
                content=f"Remote agent '{agent_id}' not found or inactive",
            )
            return

        runtime = CodexTaskRuntime(
            task_id=task_id,
            chat_id="",
            cwd=Path(cwd),
            prompt=prompt,
            agent_id=agent_id,
            model=model,
            conversation_id=conversation_id,
            session_id=session_id,
        )

        logger.info(
            "[executor] task=%s agent=%s a2a endpoint=%s",
            task_id,
            agent_id,
            config.endpoint_url,
        )
        yield TaskEvent(
            type="started",
            metadata={"agent_id": agent_id, "endpoint_url": config.endpoint_url},
        )

        adapter = A2AAdapter()
        output_parts: list[str] = []
        approval_requested = False
        completed = False
        failure_msg: Optional[str] = None
        last_status = ""
        sid = session_id or ""

        try:
            async for event in adapter.execute(runtime, config):
                if not isinstance(event, dict):
                    continue
                etype = event.get("type")
                if etype == "output_chunk":
                    text = str(event.get("content") or "")
                    if text:
                        output_parts.append(text)
                        yield TaskEvent(type="output", content=text, session_id=sid)
                elif etype == "status_changed":
                    last_status = str(event.get("status") or "")
                    if last_status:
                        yield TaskEvent(
                            type="progress",
                            content=last_status,
                            session_id=sid,
                        )
                elif etype == "approval_request":
                    if not config.approval_required:
                        # 未启用远程审批：将其作为中间进度传递，不中断执行
                        msg = str(event.get("message") or "")
                        yield TaskEvent(
                            type="progress",
                            content=msg or "input_required",
                            session_id=sid,
                        )
                        continue
                    approval_requested = True
                    msg = str(event.get("message") or "")
                    yield TaskEvent(
                        type="approval_request",
                        content=msg,
                        session_id=sid,
                    )
                    break
                elif etype == "completed":
                    result_text = str(event.get("result") or "")
                    if result_text:
                        output_parts.append(result_text)
                    completed = True
                elif etype == "failed":
                    failure_msg = str(event.get("error") or "")
                    break
                else:
                    # unknown / 未识别事件静默丢弃
                    continue
        except asyncio.CancelledError:
            yield TaskEvent(type="cancelled", content="Task was cancelled")
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("[executor] task=%s a2a execution error", task_id)
            yield TaskEvent(
                type="failed",
                content=f"A2A execution error: {type(exc).__name__}: {exc}",
                session_id=sid,
            )
            return

        if approval_requested:
            return

        final_output = "\n".join(p for p in output_parts if p)
        if failure_msg is not None:
            yield TaskEvent(
                type="failed",
                content=failure_msg or "Remote A2A agent failed",
                session_id=sid,
            )
            return

        if completed or last_status == "completed":
            yield TaskEvent(
                type="completed",
                content=final_output,
                session_id=sid,
                metadata={"agent_id": agent_id},
            )
        else:
            yield TaskEvent(
                type="failed",
                content=final_output or f"Remote A2A agent ended in state '{last_status}'",
                session_id=sid,
            )

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
