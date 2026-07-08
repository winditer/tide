"""
DaemonWSClient — WebSocket 客户端，连接 Tide 后端的 /ws/daemon 端点。

职责：
1. 连接并注册（上报 daemon_id、能力、agents）
2. 维持心跳保活
3. 接收 task_dispatch → 调用本地 executor 执行
4. 流式回传 task_event，终态回传 task_result
5. 断线指数退避重连（含随机 jitter）

说明：本客户端复用 Bridge 现有的单例 CLIExecutor（executor.py），
其接口为 create_task() 返回运行时对象、run_streaming() 产出 A2A 事件流、
cancel() 取消任务。此处对这些接口做了适配封装。
"""

import asyncio
import json
import logging
import random
import uuid
from pathlib import Path
from typing import Any, Optional

import websockets

from websockets.exceptions import ConnectionClosed

try:  # websockets>=13 将 InvalidStatusCode 重命名为 InvalidStatus
    from websockets.exceptions import InvalidStatusCode
except ImportError:  # pragma: no cover - 版本兼容
    try:
        from websockets.exceptions import InvalidStatus as InvalidStatusCode
    except ImportError:
        InvalidStatusCode = ConnectionClosed

import bridge_config as config
from git_manager import GitContext

logger = logging.getLogger("a2a-bridge.daemon_client")


class DaemonWSClient:
    """WebSocket 推模式客户端。"""

    def __init__(
        self,
        tide_ws_url: str,
        daemon_token: str,
        daemon_id: str = "",
        heartbeat_interval: int = 15,
        capability_tags: list = None,
        agents: list = None,
        skills: list = None,
        name: str = "a2a-bridge",
        endpoint_url: str = "",
        max_concurrency: int = 5,
    ):
        self.tide_ws_url = self._normalize_ws_scheme(tide_ws_url)
        self.daemon_token = daemon_token
        self.daemon_id = daemon_id or self._resolve_daemon_id()
        self.heartbeat_interval = heartbeat_interval
        self.capability_tags = capability_tags or []
        self.agents = agents or []
        self.skills = skills or []
        self.name = name
        self.endpoint_url = endpoint_url
        self.max_concurrency = max_concurrency

        self._ws: Optional[Any] = None
        self._connected = False
        self._running = False
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._executor = None  # 注入外部 executor
        # dispatch_task_id -> executor 内部任务 id 的映射（用于取消）
        self._task_map: dict[str, str] = {}

    @staticmethod
    def _normalize_ws_scheme(url: str) -> str:
        """将 http(s) scheme 归一化为 ws(s)，保留路径与 query string。"""
        if url.startswith("https://"):
            return "wss://" + url[len("https://"):]
        if url.startswith("http://"):
            return "ws://" + url[len("http://"):]
        return url

    def set_executor(self, executor):
        """注入 executor 实例，用于执行收到的任务。"""
        self._executor = executor

    @staticmethod
    def _resolve_daemon_id() -> str:
        """解析 daemon ID：环境变量 > 持久化文件 > 新生成。

        避免每次重启都生成新 UUID，导致 remote_agents 表积累多条记录。
        仅当显式设置了 DAEMON_ID 环境变量时才使用配置值。
        """
        from bridge_config import DAEMON_ID
        if DAEMON_ID:
            return DAEMON_ID

        id_file = Path.home() / ".a2a-bridge" / ".daemon_id"
        try:
            if id_file.exists():
                stored = id_file.read_text().strip()
                if stored:
                    return stored
        except OSError as e:
            logger.warning("Failed to read persisted daemon_id: %s", e)

        # 首次生成并持久化
        new_id = str(uuid.uuid4())
        try:
            id_file.parent.mkdir(parents=True, exist_ok=True)
            id_file.write_text(new_id)
        except OSError as e:
            logger.warning("Failed to persist daemon_id: %s", e)
        return new_id

    # ── 连接工具 ─────────────────────────────────────────
    def _ws_is_open(self) -> bool:
        """兼容不同 websockets 版本的连接开启判断。"""
        ws = self._ws
        if ws is None:
            return False
        closed = getattr(ws, "closed", None)
        if closed is not None:
            return not closed
        state = getattr(ws, "state", None)
        if state is not None:
            return getattr(state, "name", "") == "OPEN"
        return True

    async def start(self):
        """启动客户端（后台循环：连接 → 运行 → 断线重连）。"""
        self._running = True
        reconnect_delay = 1.0
        max_delay = 60.0

        while self._running:
            try:
                url = f"{self.tide_ws_url}?token={self.daemon_token}"
                logger.info("Connecting to Tide daemon endpoint: %s", self.tide_ws_url)

                async with websockets.connect(url, ping_interval=None, ping_timeout=None) as ws:
                    self._ws = ws
                    self._connected = True
                    reconnect_delay = 1.0  # 重置重连延迟

                    # 发送 register
                    await self._send_register()

                    # 等待 registered 响应
                    response = await ws.recv()
                    resp_data = json.loads(response)
                    if resp_data.get("type") == "registered":
                        server_interval = resp_data.get("heartbeat_interval", self.heartbeat_interval)
                        self.heartbeat_interval = server_interval
                        logger.info("Daemon registered successfully, heartbeat_interval=%ds", server_interval)
                    else:
                        logger.warning("Unexpected response after register: %s", resp_data)

                    # 启动心跳
                    self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

                    # 消息接收循环
                    try:
                        async for raw_msg in ws:
                            await self._handle_message(raw_msg)
                    finally:
                        if self._heartbeat_task:
                            self._heartbeat_task.cancel()
                            self._heartbeat_task = None

            except (ConnectionClosed, OSError, InvalidStatusCode) as e:
                self._connected = False
                self._ws = None
                if not self._running:
                    break
                # 指数退避 + 随机 jitter
                jitter = random.uniform(0, reconnect_delay * 0.3)
                wait = reconnect_delay + jitter
                logger.warning(
                    "Daemon WS disconnected (%s), reconnecting in %.1fs...", e, wait
                )
                await asyncio.sleep(wait)
                reconnect_delay = min(reconnect_delay * 2, max_delay)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._connected = False
                self._ws = None
                if not self._running:
                    break
                logger.exception("Daemon WS unexpected error: %s", e)
                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 2, max_delay)

        logger.info("DaemonWSClient stopped")

    async def stop(self):
        """停止客户端。"""
        self._running = False
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self._ws and self._ws_is_open():
            await self._ws.close()
        self._connected = False
        logger.info("DaemonWSClient shutdown requested")

    # ── 内部方法 ─────────────────────────────────────────

    async def _send_register(self):
        """发送 register 消息。"""
        bridge_name = config.resolve_bridge_name(self.daemon_id)
        msg = {
            "type": "register",
            "daemon_id": self.daemon_id,
            "bridge_name": bridge_name,
            "name": self.name,
            "endpoint_url": self.endpoint_url,
            "version": "1.0",
            "max_concurrency": self.max_concurrency,
            "agents": self.agents,
            "skills": self.skills,
            "capability_tags": self.capability_tags,
        }
        await self._ws.send(json.dumps(msg))

    def _count_active_tasks(self) -> int:
        """统计当前活跃任务数（兼容 executor 的 list_active 接口）。"""
        if not self._executor:
            return 0
        list_active = getattr(self._executor, "list_active", None)
        if callable(list_active):
            try:
                return len(list_active())
            except Exception:
                return 0
        return len(getattr(self._executor, "_tasks", {}))

    async def _heartbeat_loop(self):
        """定期发送心跳。"""
        while self._connected and self._running:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                if self._ws_is_open():
                    active_tasks = self._count_active_tasks()
                    load = active_tasks / max(self.max_concurrency, 1)
                    msg = {
                        "type": "heartbeat",
                        "active_tasks": active_tasks,
                        "load": load,
                        "status": "online",
                    }
                    await self._ws.send(json.dumps(msg))
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug("Heartbeat send failed: %s", e)
                break

    async def _handle_message(self, raw_msg: str):
        """处理从服务端收到的消息。"""
        try:
            msg = json.loads(raw_msg)
        except json.JSONDecodeError:
            logger.warning("Invalid JSON from server: %s", raw_msg[:100])
            return

        msg_type = msg.get("type", "")

        if msg_type == "heartbeat_ack":
            pass  # 心跳确认，无需处理

        elif msg_type == "task_dispatch":
            asyncio.create_task(self._execute_task(msg))

        elif msg_type == "task_cancel":
            await self._cancel_task(msg)

        else:
            logger.debug("Unknown server message type: %s", msg_type)

    def _resolve_git_ctx(self, cfg: dict) -> Optional[GitContext]:
        """从 configuration.git 或环境变量默认值构造 GitContext。"""
        git_data = cfg.get("git")
        if isinstance(git_data, dict) and git_data:
            return GitContext.from_dict(git_data)
        if config.GIT_DEFAULT_REPO:
            return GitContext(
                repo_url=config.GIT_DEFAULT_REPO,
                base_branch=config.GIT_DEFAULT_BRANCH or "main",
            )
        return None

    @staticmethod
    def _extract_event(ev: dict) -> tuple[str, str, str]:
        """将 executor 产出的 A2A 事件映射为 (state, content, kind)。"""
        kind = ev.get("kind", "")
        if kind == "status-update":
            status = ev.get("status") or {}
            state = status.get("state", "working")
            content = ""
            message = status.get("message")
            if isinstance(message, dict):
                for part in message.get("parts", []) or []:
                    if isinstance(part, dict) and part.get("kind") == "text":
                        content += part.get("text", "") or ""
            return state, content, "status"
        if kind == "artifact-update":
            artifact = ev.get("artifact") or {}
            content = ""
            for part in artifact.get("parts", []) or []:
                if isinstance(part, dict) and part.get("kind") == "text":
                    content += part.get("text", "") or ""
            return "working", content, "artifact"
        return "working", "", "output"

    @staticmethod
    def _dedup_artifacts(artifacts: list, pushed_texts: set) -> list:
        """过滤掉已通过流式 task_event 推送过的 artifact。

        终态 task_result 会携带 executor 累积的全部 artifacts，而这些内容
        已在流式阶段逐段推送。若不过滤，后端会将流式 output_chunk 与
        终态 artifacts 双重累计，导致 AI 回复重复多次。此处仅保留尚未
        推送过的新内容（通常为空），确保每段文本只传递一次。
        """
        if not artifacts:
            return []
        result: list = []
        for art in artifacts:
            if not isinstance(art, dict):
                result.append(art)
                continue
            texts: list[str] = []
            for part in art.get("parts", []) or []:
                if isinstance(part, dict) and part.get("kind") == "text":
                    texts.append(part.get("text", "") or "")
            norm = "".join(texts).strip()
            if norm and norm in pushed_texts:
                continue
            result.append(art)
        return result

    async def _execute_task(self, msg: dict):
        """接收 task_dispatch 后执行任务并回传事件。"""
        task_id = msg.get("task_id", "")
        if not task_id:
            return

        if not self._executor:
            logger.error("No executor configured, cannot execute task %s", task_id)
            await self._send_task_result(task_id, "failed", error="No executor available")
            return

        try:
            # 通知开始执行
            await self._send_task_event(task_id, "working", "Task execution started", kind="status")

            prompt = msg.get("prompt", "")
            skill = msg.get("skill", "") or msg.get("agent", "")
            configuration = msg.get("configuration", {}) or {}

            # 解析 Agent 配置，回退到默认 Agent
            skill_name, agent_cfg = config.get_agent_config(skill)
            work_dir = (
                configuration.get("workDir")
                or configuration.get("cwd")
                or config.WORK_DIR
            )
            git_ctx = self._resolve_git_ctx(configuration)

            # 使用 executor 现有接口创建任务；复用 dispatch task_id 便于取消
            rt = self._executor.create_task(
                prompt=prompt,
                skill=skill_name,
                agent_cfg=agent_cfg,
                work_dir=work_dir,
                context_id=msg.get("context_id"),
                task_id=task_id,
                configuration=configuration,
            )
            self._task_map[task_id] = rt.task.id

            # 内容去重：同一段文本可能既作为 assistant 消息（EVENT_MESSAGE）又作为
            # result 完成事件（EVENT_COMPLETE）被推送（Claude 的 result 事件会重复
            # 最终 assistant 文本），且终态 task_result 会再次携带全部 artifacts，
            # 后端会把流式 output_chunk 与终态 artifacts 双重累计，导致内容重复多次。
            # 此处按内容去重，确保每段 AI 文本只推送一次。
            pushed_texts: set[str] = set()

            # 流式读取输出并回传
            async for ev in self._executor.run_streaming(
                rt,
                prompt=prompt,
                agent_cfg=agent_cfg,
                work_dir=work_dir,
                configuration=configuration,
                git_ctx=git_ctx,
            ):
                state, content, kind = self._extract_event(ev)
                if kind in ("artifact", "output"):
                    norm = (content or "").strip()
                    if not norm:
                        continue
                    if norm in pushed_texts:
                        # 重复内容（如 result 事件回显 assistant 文本）跳过
                        continue
                    pushed_texts.add(norm)
                    await self._send_task_event(task_id, state, content, kind=kind)
                elif content or kind != "status":
                    await self._send_task_event(task_id, state, content, kind=kind)

            # 获取最终结果（run_streaming 结束后 task 已进入终态）
            final_state = rt.task.state.value if rt.task.state else "completed"
            if final_state == "failed":
                await self._send_task_result(
                    task_id,
                    "failed",
                    artifacts=self._dedup_artifacts(rt.task.artifacts, pushed_texts),
                    error=rt.task.error or "",
                )
            else:
                await self._send_task_result(
                    task_id,
                    state=final_state,
                    artifacts=self._dedup_artifacts(rt.task.artifacts, pushed_texts),
                )

        except Exception as e:
            logger.exception("Task %s execution failed: %s", task_id, e)
            await self._send_task_result(task_id, "failed", error=str(e))
        finally:
            self._task_map.pop(task_id, None)

    async def _cancel_task(self, msg: dict):
        """取消正在运行的任务。"""
        task_id = msg.get("task_id", "")
        if task_id and self._executor:
            exec_task_id = self._task_map.get(task_id, task_id)
            try:
                await self._executor.cancel(exec_task_id)
                logger.info("Task %s cancelled", task_id)
            except Exception as e:
                logger.warning("Failed to cancel task %s: %s", task_id, e)

    async def _send_task_event(self, task_id: str, state: str, content: str, kind: str = "output"):
        """发送流式任务事件。"""
        if self._ws_is_open():
            msg = {
                "type": "task_event",
                "task_id": task_id,
                "kind": kind,
                "content": content,
                "state": state,
            }
            try:
                await self._ws.send(json.dumps(msg))
            except Exception as e:
                logger.debug("Failed to send task_event: %s", e)

    async def _send_task_result(self, task_id: str, state: str, artifacts: list = None, error: str = ""):
        """发送任务终态结果。"""
        if self._ws_is_open():
            msg = {
                "type": "task_result",
                "task_id": task_id,
                "state": state,
                "artifacts": artifacts or [],
            }
            if error:
                msg["error"] = error
            try:
                await self._ws.send(json.dumps(msg))
            except Exception as e:
                logger.debug("Failed to send task_result: %s", e)
