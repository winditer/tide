"""
WebSocket 端点：/ws/daemon — Daemon 能力注册与任务通道。

与前端 /ws (ws_hub) 完全隔离，使用独立的 DAEMON_TOKEN 鉴权。
协议：JSON 消息帧，type 字段区分消息类型。
"""

import json
import logging
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from backend.services.daemon_registry import daemon_registry

logger = logging.getLogger("tide.ws_daemon")

router = APIRouter()

DAEMON_TOKEN = os.getenv("DAEMON_TOKEN", "")


@router.websocket("/ws/daemon")
async def websocket_daemon(ws: WebSocket, token: str = Query("")):
    """Daemon WebSocket 端点。

    连接方式：ws(s)://<host>/ws/daemon?token=<DAEMON_TOKEN>

    协议（JSON 消息）：
    - Daemon→服务端：register, heartbeat, capability_update, task_event, task_result
    - 服务端→Daemon：registered, heartbeat_ack, task_dispatch, task_cancel
    """
    # 鉴权
    if DAEMON_TOKEN and token != DAEMON_TOKEN:
        await ws.close(code=4001, reason="Invalid daemon token")
        return

    await ws.accept()
    daemon_id: str = ""

    try:
        # 等待首帧 register 消息
        raw = await ws.receive_text()
        msg = json.loads(raw)

        if msg.get("type") != "register":
            await ws.close(code=4002, reason="First message must be register")
            return

        daemon_id = msg.get("daemon_id", "")
        if not daemon_id:
            await ws.close(code=4003, reason="daemon_id required")
            return

        # 注册
        response = await daemon_registry.register(daemon_id, ws, msg)
        await ws.send_text(json.dumps({"type": "registered", **response}))

        # 消息循环
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type", "")

            if msg_type == "heartbeat":
                await daemon_registry.on_heartbeat(daemon_id, msg)
                await ws.send_text(json.dumps({"type": "heartbeat_ack"}))

            elif msg_type == "capability_update":
                await daemon_registry.on_capability_update(daemon_id, msg)

            elif msg_type == "task_event":
                task_id = msg.get("task_id", "")
                if task_id:
                    await daemon_registry.route_task_event(task_id, msg)

            elif msg_type == "task_result":
                task_id = msg.get("task_id", "")
                if task_id:
                    await daemon_registry.route_task_event(task_id, msg)
                    # 终态：清理队列（延迟清理，给消费者时间取出）
                    # 由消费者自行调用 unregister_task

            else:
                logger.debug("Unknown daemon message type: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("Daemon %s WebSocket disconnected", daemon_id[:8] if daemon_id else "unknown")
    except json.JSONDecodeError as e:
        logger.warning("Invalid JSON from daemon %s: %s", daemon_id[:8] if daemon_id else "unknown", e)
    except Exception as e:
        logger.exception("Daemon WS error for %s: %s", daemon_id[:8] if daemon_id else "unknown", e)
    finally:
        if daemon_id:
            await daemon_registry.disconnect(daemon_id)
