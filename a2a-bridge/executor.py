"""CLI 执行器。

负责将 A2A 请求映射为本地 Codex/Claude/Qoder CLI 的子进程调用，
读取 stdout，解析输出事件并转换为 A2A 标准事件流。

设计要点：
- 全局并发由 asyncio.Semaphore 控制
- 任务对象保存在内存 dict 中（单实例）
- 支持 cancel：通过 process.terminate() 杀死子进程
- 应用关闭时统一 kill 所有活跃任务
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shlex
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

import bridge_config as config
from git_manager import GitContext, get_git_manager
from event_parser import (
    EVENT_APPROVAL,
    EVENT_COMPLETE,
    EVENT_ERROR,
    EVENT_MESSAGE,
    EVENT_PROGRESS,
    EVENT_SESSION,
    EVENT_TOOL_RESULT,
    EVENT_TOOL_USE,
    ParsedEvent,
    parse_line,
)
from models import (
    A2ATask,
    TaskState,
    artifact_update_event,
    gen_id,
    make_artifact,
    make_message,
    status_update_event,
)

logger = logging.getLogger(__name__)


# ---------------- 任务执行上下文 ----------------
@dataclass
class _TaskRuntime:
    """运行时附加信息（不暴露给客户端）。"""

    task: A2ATask
    process: Optional[asyncio.subprocess.Process] = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    finished: asyncio.Event = field(default_factory=asyncio.Event)
    output_buffer: list[str] = field(default_factory=list)


class CLIExecutor:
    """单例执行器，负责管理所有任务。"""

    def __init__(self) -> None:
        self._tasks: dict[str, _TaskRuntime] = {}
        self._semaphore = asyncio.Semaphore(config.MAX_CONCURRENCY)
        self._lock = asyncio.Lock()

    # ---------- 公共 API ----------
    def get_task(self, task_id: str) -> Optional[A2ATask]:
        rt = self._tasks.get(task_id)
        return rt.task if rt else None

    def list_active(self) -> list[str]:
        return [tid for tid, rt in self._tasks.items() if not rt.finished.is_set()]

    async def cancel(self, task_id: str) -> bool:
        rt = self._tasks.get(task_id)
        if not rt:
            return False
        if rt.finished.is_set():
            return False
        rt.cancel_event.set()
        proc = rt.process
        if proc and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
        return True

    async def shutdown(self) -> None:
        """优雅关闭：取消所有未完成任务。"""
        for tid in list(self._tasks.keys()):
            rt = self._tasks.get(tid)
            if rt and not rt.finished.is_set():
                await self.cancel(tid)

    # ---------- 任务创建 ----------
    def create_task(
        self,
        *,
        prompt: str,
        skill: str,
        agent_cfg: config.AgentConfig,
        work_dir: str,
        context_id: Optional[str],
        task_id: Optional[str],
        configuration: dict[str, Any],
    ) -> _TaskRuntime:
        task = A2ATask(
            id=task_id or gen_id("task-"),
            context_id=context_id or gen_id("ctx-"),
            skill=skill,
            state=TaskState.SUBMITTED,
            metadata={
                "workDir": work_dir,
                "model": configuration.get("model") or agent_cfg.model,
            },
        )
        # 把用户消息记入 history
        task.history.append(make_message("user", prompt))
        rt = _TaskRuntime(task=task)
        self._tasks[task.id] = rt
        return rt

    # ---------- 阻塞执行（message/send） ----------
    async def run_blocking(
        self,
        rt: _TaskRuntime,
        *,
        prompt: str,
        agent_cfg: config.AgentConfig,
        work_dir: str,
        configuration: dict[str, Any],
        git_ctx: Optional[GitContext] = None,
    ) -> A2ATask:
        events: list[dict[str, Any]] = []
        async for ev in self.run_streaming(
            rt,
            prompt=prompt,
            agent_cfg=agent_cfg,
            work_dir=work_dir,
            configuration=configuration,
            git_ctx=git_ctx,
        ):
            events.append(ev)
        return rt.task
    
    # ---------- 流式执行（message/stream） ----------
    async def run_streaming(
        self,
        rt: _TaskRuntime,
        *,
        prompt: str,
        agent_cfg: config.AgentConfig,
        work_dir: str,
        configuration: dict[str, Any],
        git_ctx: Optional[GitContext] = None,
    ) -> AsyncIterator[dict[str, Any]]:
        # 立即发出 submitted 状态
        rt.task.state = TaskState.SUBMITTED
        rt.task.touch()
        yield status_update_event(rt.task)
    
        # 启动子任务执行 CLI；通过 queue 解耦
        worker = asyncio.create_task(
            self._execute(
                rt,
                prompt=prompt,
                agent_cfg=agent_cfg,
                work_dir=work_dir,
                configuration=configuration,
                git_ctx=git_ctx,
            )
        )

        try:
            while True:
                ev = await rt.queue.get()
                if ev is None:
                    break
                yield ev
        finally:
            # 确保 worker 结束
            if not worker.done():
                worker.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await worker

    # ---------- 内部：真正的子进程驱动 ----------
    async def _execute(
        self,
        rt: _TaskRuntime,
        *,
        prompt: str,
        agent_cfg: config.AgentConfig,
        work_dir: str,
        configuration: dict[str, Any],
        git_ctx: Optional[GitContext] = None,
    ) -> None:
        # Git 工作区准备（可选）：如果提供了 git_ctx，则 prepare_workspace
        # 并用该路径覆盖 work_dir；任务结束后调用 finalize_changes。
        gm = get_git_manager() if git_ctx else None
        repo_path = None
        git_prepared = False
        if gm and git_ctx:
            try:
                repo_path = await gm.prepare_workspace(git_ctx)
                work_dir = str(repo_path)
                git_prepared = True
                rt.task.metadata["git"] = {
                    "repoUrl": git_ctx.repo_url,
                    "baseBranch": git_ctx.base_branch,
                    "branch": git_ctx.task_branch,
                }
            except Exception as exc:
                logger.exception("git prepare_workspace failed: %s", exc)
                await self._finish(
                    rt,
                    state=TaskState.FAILED,
                    error=f"git prepare failed: {exc}",
                )
                return

        try:
            async with self._semaphore:
                if rt.cancel_event.is_set():
                    await self._finish(rt, state=TaskState.CANCELED, error="canceled before start")
                    return

                argv = self._build_argv(rt.task.skill, agent_cfg, configuration, prompt, work_dir=work_dir)
                env = self._build_env()
                cwd = work_dir or config.WORK_DIR
                # 工作目录不存在时回退到 / 避免 subprocess 启动失败
                if not os.path.isdir(cwd):
                    logger.warning("work_dir %s does not exist, falling back to /tmp", cwd)
                    cwd = "/tmp"

                # 切换到 working
                rt.task.state = TaskState.WORKING
                rt.task.touch()
                await rt.queue.put(status_update_event(rt.task))

                logger.info(
                    "starting task=%s skill=%s argv=%s cwd=%s",
                    rt.task.id, rt.task.skill, " ".join(shlex.quote(a) for a in argv), cwd,
                )

                try:
                    proc = await asyncio.create_subprocess_exec(
                        *argv,
                        stdin=asyncio.subprocess.DEVNULL,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        cwd=cwd,
                        env=env,
                    )
                except FileNotFoundError as exc:
                    await self._finish(rt, state=TaskState.FAILED, error=f"CLI binary not found: {exc}")
                    return

                rt.process = proc
                stdout_task = asyncio.create_task(self._pump_stdout(rt))
                stderr_task = asyncio.create_task(self._pump_stderr(rt))

                timeout = configuration.get("timeout") or agent_cfg.timeout or config.DEFAULT_TIMEOUT
                try:
                    await asyncio.wait_for(proc.wait(), timeout=timeout)
                except asyncio.TimeoutError:
                    with contextlib.suppress(ProcessLookupError):
                        proc.terminate()
                    with contextlib.suppress(asyncio.TimeoutError):
                        await asyncio.wait_for(proc.wait(), timeout=5)
                    if proc.returncode is None:
                        with contextlib.suppress(ProcessLookupError):
                            proc.kill()
                    await self._finish(rt, state=TaskState.FAILED, error=f"CLI timeout after {timeout}s")
                    await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
                    return

                await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
                rc = proc.returncode

                if rt.cancel_event.is_set():
                    await self._finish(rt, state=TaskState.CANCELED, error=None)
                    return
                if rt.task.state == TaskState.INPUT_REQUIRED:
                    # 已进入等待审批状态，不再覆盖
                    await self._finish(rt, state=TaskState.INPUT_REQUIRED, error=None, terminal=False)
                    return
                if rc == 0:
                    # CLI 成功：如果开启了 git 工作区，进行 finalize
                    if git_prepared and gm and git_ctx and config.GIT_AUTO_PUSH and repo_path is not None:
                        try:
                            sha = await gm.finalize_changes(git_ctx, repo_path)
                            git_meta = rt.task.metadata.setdefault("git", {})
                            git_meta["branch"] = git_ctx.task_branch
                            if sha:
                                git_meta["sha"] = sha
                        except Exception as exc:
                            logger.exception("git finalize_changes failed: %s", exc)
                            await self._finish(
                                rt,
                                state=TaskState.FAILED,
                                error=f"git finalize failed: {exc}",
                            )
                            return
                    await self._finalize_complete(rt)
                else:
                    err_text = "\n".join(rt.output_buffer[-20:]).strip() or f"exit code {rc}"
                    await self._finish(rt, state=TaskState.FAILED, error=err_text)
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("executor error: %s", exc)
            await self._finish(rt, state=TaskState.FAILED, error=str(exc))

    # ---------- 子进程 stdout/stderr 解析 ----------
    async def _pump_stdout(self, rt: _TaskRuntime) -> None:
        proc = rt.process
        assert proc and proc.stdout
        async for raw in proc.stdout:
            try:
                line = raw.decode("utf-8", errors="replace")
            except Exception:
                continue
            await self._handle_line(rt, line)

    async def _pump_stderr(self, rt: _TaskRuntime) -> None:
        proc = rt.process
        assert proc and proc.stderr
        async for raw in proc.stderr:
            try:
                line = raw.decode("utf-8", errors="replace").rstrip()
            except Exception:
                continue
            if not line:
                continue
            rt.output_buffer.append(line)
            # stderr 仅作为进度消息发送，不直接报错
            msg = make_message("agent", f"[stderr] {line}")
            ev = status_update_event(rt.task, message=msg)
            await rt.queue.put(ev)

    async def _handle_line(self, rt: _TaskRuntime, line: str) -> None:
        ev = parse_line(rt.task.skill, line)
        if ev is None:
            return
        if ev.type == EVENT_SESSION:
            sid = ev.metadata.get("session_id")
            if sid:
                rt.task.metadata["sessionId"] = sid
            return
        if ev.type == EVENT_MESSAGE:
            if not ev.text:
                return
            artifact = make_artifact(ev.text, name="message")
            rt.task.artifacts.append(artifact)
            rt.task.touch()
            await rt.queue.put(artifact_update_event(rt.task, artifact, append=True))
            return
        if ev.type == EVENT_COMPLETE:
            if ev.text:
                artifact = make_artifact(ev.text, name="result")
                rt.task.artifacts.append(artifact)
                await rt.queue.put(artifact_update_event(rt.task, artifact, last_chunk=True))
            return
        if ev.type == EVENT_TOOL_USE:
            msg = make_message("agent", ev.text or "[tool_use]")
            await rt.queue.put(status_update_event(rt.task, message=msg))
            return
        if ev.type == EVENT_TOOL_RESULT:
            if ev.text:
                msg = make_message("agent", f"[tool_result] {ev.text[:500]}")
                await rt.queue.put(status_update_event(rt.task, message=msg))
            return
        if ev.type == EVENT_PROGRESS:
            if ev.text:
                msg = make_message("agent", ev.text)
                await rt.queue.put(status_update_event(rt.task, message=msg))
            return
        if ev.type == EVENT_APPROVAL:
            rt.task.state = TaskState.INPUT_REQUIRED
            rt.task.touch()
            msg = make_message("agent", ev.text or "Approval required")
            await rt.queue.put(status_update_event(rt.task, message=msg, final=True))
            return
        if ev.type == EVENT_ERROR:
            rt.task.error = ev.text or "agent error"
            return

    # ---------- 状态收尾 ----------
    async def _finalize_complete(self, rt: _TaskRuntime) -> None:
        rt.task.state = TaskState.COMPLETED
        rt.task.touch()
        await rt.queue.put(status_update_event(rt.task, final=True))
        rt.finished.set()
        await rt.queue.put(None)

    async def _finish(
        self,
        rt: _TaskRuntime,
        *,
        state: TaskState,
        error: Optional[str],
        terminal: bool = True,
    ) -> None:
        rt.task.state = state
        if error:
            rt.task.error = error
        rt.task.touch()
        msg = None
        if error:
            msg = make_message("agent", error)
        await rt.queue.put(status_update_event(rt.task, message=msg, final=terminal))
        rt.finished.set()
        await rt.queue.put(None)

    # ---------- argv / env 构造 ----------
    def _build_argv(
        self,
        skill: str,
        agent_cfg: config.AgentConfig,
        configuration: dict[str, Any],
        prompt: str,
        *,
        work_dir: Optional[str] = None,
    ) -> list[str]:
        model = configuration.get("model") or agent_cfg.model
        # "auto" 或空值不传 -m，让 CLI 使用自己的环境变量配置
        if model and model.lower() in ("auto", "default", ""):
            model = ""
        cwd = (
            work_dir
            or configuration.get("workDir")
            or configuration.get("cwd")
            or config.WORK_DIR
        )
        # 验证 cwd 存在性，不存在则置空（让 CLI 使用 subprocess 的 cwd）
        if cwd and not os.path.isdir(cwd):
            logger.warning("_build_argv: cwd %s does not exist, skipping -C", cwd)
            cwd = ""
        if skill == "codex":
            argv = [agent_cfg.bin]
            if model:
                argv += ["-m", model]
            approval = configuration.get("approvalPolicy") or agent_cfg.approval_policy
            sandbox = configuration.get("sandboxMode") or agent_cfg.sandbox_mode
            if approval:
                argv += ["-a", approval]
            if sandbox:
                argv += ["-s", sandbox]
            argv += ["exec", "--json", "--skip-git-repo-check"]
            if cwd:
                argv += ["-C", cwd]
            argv += list(agent_cfg.extra_args)
            # fullAuto: 确保使用宽松权限（--full-auto 已废弃，改用 -a/-s 参数）
            if configuration.get("fullAuto", True):
                if not approval:
                    argv += ["-a", "full-auto"]
                if not sandbox:
                    argv += ["-s", "workspace-write"]
            argv += [prompt]
            return argv
        if skill == "claude":
            argv = [agent_cfg.bin, "--print", "--output-format", "stream-json", "--verbose"]
            if model:
                argv += ["--model", model]
            permission = configuration.get("permissionMode") or agent_cfg.permission_mode
            if permission:
                argv += ["--permission-mode", permission]
            argv += list(agent_cfg.extra_args)
            argv += [prompt]
            return argv
        if skill == "qoder":
            argv = [agent_cfg.bin, "--print", "--output-format", "stream-json"]
            if cwd:
                argv += ["--cwd", cwd]
            if model:
                argv += ["--model", model]
            permission = configuration.get("permissionMode") or agent_cfg.permission_mode
            if permission:
                argv += ["--permission-mode", permission]
            argv += list(agent_cfg.extra_args)
            argv += [prompt]
            return argv
        # 未知 skill：直接调用 bin
        return [agent_cfg.bin, prompt]

    def _build_env(self) -> dict[str, str]:
        env = dict(os.environ)
        env.setdefault("PYTHONUNBUFFERED", "1")
        return env


# 全局单例
executor = CLIExecutor()
