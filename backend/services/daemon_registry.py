"""
DaemonRegistry — Daemon WebSocket 推模式的核心注册表。

维护 Daemon 连接、能力缓存、心跳检测，以及 task_id → asyncio.Queue 的
任务事件桥接管道。与前端 ws_hub 完全隔离。
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket
from sqlalchemy import text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.daemon_registry")


@dataclass
class DaemonConnection:
    """单个 Daemon 的连接信息与能力。"""
    daemon_id: str
    ws: WebSocket
    name: str = ""
    endpoint_url: str = ""
    version: str = ""
    max_concurrency: int = 5
    agents: List[dict] = field(default_factory=list)
    skills: List[str] = field(default_factory=list)
    capability_tags: List[str] = field(default_factory=list)
    active_tasks: int = 0
    load: float = 0.0
    status: str = "online"  # online / offline
    last_heartbeat: float = field(default_factory=time.time)
    registered_at: float = field(default_factory=time.time)
    created_by: Optional[str] = None


class DaemonRegistry:
    """单例：管理所有 Daemon WS 连接和任务路由。"""

    def __init__(self):
        self._daemons: Dict[str, DaemonConnection] = {}
        self._task_queues: Dict[str, asyncio.Queue] = {}  # task_id -> event queue
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None

    # ── 生命周期 ─────────────────────────────────────────

    async def start(self):
        """启动后台心跳清理任务，并重置所有 WS 模式 agent 状态。

        后端重启后旧 WebSocket 连接不可能存活，需将 DB 中的
        daemon agent 标记为 offline，等 Bridge 重连注册后恢复 active。
        """
        # 重置所有 WS 模式 daemon agent 为 offline
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    text(
                        "UPDATE remote_agents SET status = 'offline', updated_at = :now "
                        "WHERE connection_mode = 'ws' AND status != 'offline'"
                    ),
                    {"now": datetime.now(timezone.utc).isoformat()},
                )
                await session.commit()
                if result.rowcount:  # type: ignore[union-attr]
                    logger.info("Reset %d WS daemon agents to offline on startup", result.rowcount)
        except Exception as e:
            logger.warning("Failed to reset daemon agent status on startup: %s", e)

        self._cleanup_task = asyncio.create_task(self._heartbeat_cleanup_loop())
        logger.info("DaemonRegistry started")

    async def stop(self):
        """停止后台任务。"""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            self._cleanup_task = None
        logger.info("DaemonRegistry stopped")

    # ── 注册/断开 ────────────────────────────────────────

    async def register(self, daemon_id: str, ws: WebSocket, payload: dict, created_by: Optional[str] = None) -> dict:
        """处理 Daemon 的 register 消息，返回 registered 响应载荷。"""
        conn = DaemonConnection(
            daemon_id=daemon_id,
            ws=ws,
            name=payload.get("name", ""),
            endpoint_url=payload.get("endpoint_url", ""),
            version=payload.get("version", ""),
            max_concurrency=payload.get("max_concurrency", 5),
            agents=payload.get("agents", []),
            skills=payload.get("skills", []),
            capability_tags=payload.get("capability_tags", []),
        )
        conn.created_by = created_by
        # 存储 bridge_name 供 _upsert_daemon_agents 构建显示名
        conn._bridge_name = payload.get("bridge_name", "")
        async with self._lock:
            self._daemons[daemon_id] = conn

        # 持久化到 remote_agents 表
        # 若注册消息包含 agents 列表，则为每个 agent 创建独立记录；否则回退到单条记录
        if conn.agents:
            await self._upsert_daemon_agents(conn)
        else:
            await self._upsert_remote_agent(conn)
        logger.info("Daemon registered: %s (%s), agents=%d", daemon_id[:8], conn.name, len(conn.agents))

        return {
            "server_time": datetime.now(timezone.utc).isoformat(),
            "heartbeat_interval": 15,
        }

    async def disconnect(self, daemon_id: str):
        """Daemon 断开连接。"""
        async with self._lock:
            self._daemons.pop(daemon_id, None)
        # 更新 DB 状态
        await self._mark_agent_offline(daemon_id)
        logger.info("Daemon disconnected: %s", daemon_id[:8])

    # ── 心跳 ─────────────────────────────────────────────

    async def on_heartbeat(self, daemon_id: str, payload: dict):
        """处理心跳消息，更新负载信息。"""
        async with self._lock:
            conn = self._daemons.get(daemon_id)
            if not conn:
                return
            conn.last_heartbeat = time.time()
            conn.active_tasks = payload.get("active_tasks", 0)
            conn.load = payload.get("load", 0.0)
            conn.status = payload.get("status", "online")

    # ── 能力更新 ─────────────────────────────────────────

    async def on_capability_update(self, daemon_id: str, payload: dict):
        """处理能力变更推送。"""
        async with self._lock:
            conn = self._daemons.get(daemon_id)
            if not conn:
                return
            conn.skills = payload.get("skills", conn.skills)
            conn.capability_tags = payload.get("capability_tags", conn.capability_tags)
        logger.info("Daemon %s capability updated", daemon_id[:8])

    # ── 查询 ─────────────────────────────────────────────

    def get_online_agents(self) -> List[dict]:
        """返回所有在线 Daemon 的能力信息（供 Squad Leader 决策）。"""
        result = []
        for conn in self._daemons.values():
            if conn.status == "online":
                result.append({
                    "daemon_id": conn.daemon_id,
                    "name": conn.name,
                    "endpoint_url": conn.endpoint_url,
                    "agents": conn.agents,
                    "skills": conn.skills,
                    "capability_tags": conn.capability_tags,
                    "load": conn.load,
                    "active_tasks": conn.active_tasks,
                    "max_concurrency": conn.max_concurrency,
                })
        return result

    def get_daemon_ws(self, daemon_id: str) -> Optional[WebSocket]:
        """获取 Daemon 的 WS 连接（用于任务下发）。"""
        conn = self._daemons.get(daemon_id)
        return conn.ws if conn and conn.status == "online" else None

    # ── 任务下发/回流 ────────────────────────────────────

    async def dispatch_task(self, daemon_id: str, task_id: str, payload: dict) -> Optional[asyncio.Queue]:
        """向 Daemon 下发任务，返回事件队列用于接收结果。

        如果 Daemon 暂时不在线（如后端热重启后 Bridge 尚未重连），
        会等待最多 10 秒，每 2 秒检查一次，给 Bridge 重连的时间窗口。
        """
        conn = self._daemons.get(daemon_id)
        if not conn or conn.status != "online":
            # 等待 Daemon 重连（最多 10 秒，每 2 秒检查一次）
            for _attempt in range(5):
                logger.info("dispatch_task: daemon %s not online, waiting for reconnect (%d/5)...", daemon_id[:8], _attempt + 1)
                await asyncio.sleep(2)
                conn = self._daemons.get(daemon_id)
                if conn and conn.status == "online":
                    break
            else:
                logger.warning("dispatch_task: daemon %s still not online after 10s wait", daemon_id[:8])
                return None

        # 创建事件队列
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._task_queues[task_id] = queue

        # 通过 WS 下发
        msg = json.dumps({"type": "task_dispatch", "task_id": task_id, **payload})
        try:
            await conn.ws.send_text(msg)
        except Exception as e:
            logger.error("Failed to dispatch task %s to daemon %s: %s", task_id, daemon_id[:8], e)
            async with self._lock:
                self._task_queues.pop(task_id, None)
            return None

        return queue

    async def cancel_task(self, daemon_id: str, task_id: str):
        """向 Daemon 发送取消任务指令。"""
        conn = self._daemons.get(daemon_id)
        if not conn:
            return
        try:
            await conn.ws.send_text(json.dumps({"type": "task_cancel", "task_id": task_id}))
        except Exception as e:
            logger.warning("Failed to cancel task %s: %s", task_id, e)

    async def route_task_event(self, task_id: str, event: dict):
        """将 Daemon 回传的任务事件路由到对应队列。"""
        async with self._lock:
            queue = self._task_queues.get(task_id)
        if queue:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("Task queue full for %s, dropping event", task_id)

    async def unregister_task(self, task_id: str):
        """任务完成后清理队列。"""
        async with self._lock:
            self._task_queues.pop(task_id, None)

    # ── 内部方法 ─────────────────────────────────────────

    async def _heartbeat_cleanup_loop(self):
        """后台任务：检测心跳超时的 Daemon 并标记 offline。"""
        TIMEOUT = 60  # 4 倍 heartbeat_interval(15s)
        while True:
            try:
                await asyncio.sleep(15)
                now = time.time()
                to_remove = []
                async with self._lock:
                    for daemon_id, conn in self._daemons.items():
                        if now - conn.last_heartbeat > TIMEOUT:
                            conn.status = "offline"
                            to_remove.append(daemon_id)
                for daemon_id in to_remove:
                    await self._mark_agent_offline(daemon_id)
                    logger.warning("Daemon %s marked offline (heartbeat timeout)", daemon_id[:8])
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Heartbeat cleanup error: %s", e)

    async def _upsert_remote_agent(self, conn: DaemonConnection):
        """将 Daemon 注册信息持久化到 remote_agents 表。

        使用 ON CONFLICT(id) DO UPDATE，仅更新 daemon 相关字段，
        避免覆盖手动配置的 auth_credentials 等。agent_card_url 提供空字符串
        以满足 NOT NULL 约束（Daemon 模式不需要 Agent Card URL）。
        """
        try:
            async with async_session_factory() as session:
                now = datetime.now(timezone.utc).isoformat()
                await session.execute(
                    text("""
                        INSERT INTO remote_agents
                            (id, name, endpoint_url, agent_card_url, protocol_binding, protocol_version,
                             status, connection_mode, capability_tags, last_heartbeat,
                             daemon_session_id, created_by, created_at, updated_at)
                        VALUES (:id, :name, :endpoint_url, :agent_card_url, 'JSONRPC', '1.0',
                                'active', 'ws', :capability_tags, :last_heartbeat,
                                :session_id, :created_by, :now, :now)
                        ON CONFLICT(id) DO UPDATE SET
                            name = :name,
                            status = 'active',
                            connection_mode = 'ws',
                            capability_tags = :capability_tags,
                            last_heartbeat = :last_heartbeat,
                            daemon_session_id = :session_id,
                            created_by = CASE WHEN remote_agents.created_by IS NULL THEN :created_by ELSE remote_agents.created_by END,
                            updated_at = :now
                    """),
                    {
                        "id": f"daemon-{conn.daemon_id}",
                        "name": conn.name or f"Daemon {conn.daemon_id[:8]}",
                        "endpoint_url": conn.endpoint_url or f"ws://daemon-{conn.daemon_id[:8]}",
                        "agent_card_url": "",
                        "capability_tags": json.dumps(conn.capability_tags),
                        "last_heartbeat": now,
                        "session_id": conn.daemon_id,
                        "created_by": conn.created_by,
                        "now": now,
                    },
                )
                await session.commit()
        except Exception as e:
            logger.error("Failed to upsert remote_agent for daemon %s: %s", conn.daemon_id[:8], e)

    async def _upsert_daemon_agents(self, conn: DaemonConnection):
        """为 Daemon 下的每个 agent 创建/更新独立的 remote_agents 记录。

        - 每条记录 ID 使用 `daemon-{daemon_id}-{agent_name}` 格式（稳定且唯一）；
        - name 使用 `{bridge_name}/{agent_name}` 格式作为显示名；
        - capability_tags 合并 daemon 级与 agent 级的标签；
        - 使用稳定 daemon_id 重新注册时，将该 daemon 下本次不再包含的 agent 标记为 offline。
        """
        # 从注册消息中获取 bridge_name，用于构建显示名
        bridge_name = getattr(conn, '_bridge_name', '') or ''
        try:
            async with async_session_factory() as session:
                now = datetime.now(timezone.utc).isoformat()
                active_ids: List[str] = []
                for agent in conn.agents:
                    if not isinstance(agent, dict):
                        continue
                    agent_name = str(
                        agent.get("name")
                        or agent.get("agent_id")
                        or agent.get("id")
                        or ""
                    ).strip()
                    if not agent_name:
                        continue
                    agent_record_id = f"daemon-{conn.daemon_id}-{agent_name}"
                    active_ids.append(agent_record_id)

                    # 构建显示名：{bridge_name}/{agent_name}
                    display_name = f"{bridge_name}/{agent_name}" if bridge_name else agent_name

                    # 合并 daemon 级与 agent 级能力标签
                    tags = list(conn.capability_tags or [])
                    for cap in (agent.get("capabilities") or []):
                        if cap not in tags:
                            tags.append(cap)

                    await session.execute(
                        text("""
                            INSERT INTO remote_agents
                                (id, name, endpoint_url, agent_card_url, protocol_binding, protocol_version,
                                 status, connection_mode, capability_tags, last_heartbeat,
                                 daemon_session_id, created_by, created_at, updated_at)
                            VALUES (:id, :name, :endpoint_url, :agent_card_url, 'JSONRPC', '1.0',
                                    'active', 'ws', :capability_tags, :last_heartbeat,
                                    :session_id, :created_by, :now, :now)
                            ON CONFLICT(id) DO UPDATE SET
                                name = :name,
                                status = 'active',
                                connection_mode = 'ws',
                                capability_tags = :capability_tags,
                                last_heartbeat = :last_heartbeat,
                                daemon_session_id = :session_id,
                                created_by = CASE WHEN remote_agents.created_by IS NULL THEN :created_by ELSE remote_agents.created_by END,
                                updated_at = :now
                        """),
                        {
                            "id": agent_record_id,
                            "name": display_name,
                            "endpoint_url": conn.endpoint_url or f"ws://daemon-{conn.daemon_id[:8]}",
                            "agent_card_url": "",
                            "capability_tags": json.dumps(tags),
                            "last_heartbeat": now,
                            "session_id": conn.daemon_id,
                            "created_by": conn.created_by,
                            "now": now,
                        },
                    )

                # 将该 daemon 下本次不再包含的（过时）agent 标记为 offline
                if active_ids:
                    placeholders = ",".join(f":aid{i}" for i in range(len(active_ids)))
                    params = {f"aid{i}": aid for i, aid in enumerate(active_ids)}
                    params["sid"] = conn.daemon_id
                    params["now"] = now
                    await session.execute(
                        text(f"""
                            UPDATE remote_agents SET status = 'offline', updated_at = :now
                            WHERE daemon_session_id = :sid AND connection_mode = 'ws'
                              AND id NOT IN ({placeholders})
                        """),
                        params,
                    )
                await session.commit()
        except Exception as e:
            logger.error("Failed to upsert daemon agents for daemon %s: %s", conn.daemon_id[:8], e)

    async def _mark_agent_offline(self, daemon_id: str):
        """标记 DB 中的 remote_agent 为 offline。"""
        try:
            async with async_session_factory() as session:
                await session.execute(
                    text("UPDATE remote_agents SET status = 'offline', updated_at = :now WHERE daemon_session_id = :sid"),
                    {"sid": daemon_id, "now": datetime.now(timezone.utc).isoformat()},
                )
                await session.commit()
        except Exception as e:
            logger.warning("Failed to mark daemon %s offline: %s", daemon_id[:8], e)


# 模块级单例
daemon_registry = DaemonRegistry()
