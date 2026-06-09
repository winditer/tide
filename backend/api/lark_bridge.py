"""
Lark Bridge API 端点。

供 lark2agent_ws.py 调用的内部接口：
- POST /api/lark/notify  通知 Web 端有新任务/状态变更
- GET  /api/lark/status  查询 Lark Bridge 连接状态
"""

from __future__ import annotations

import logging

from fastapi import APIRouter

from backend.models.schemas import LarkBridgeStatus, LarkNotifyPayload
from backend.services.lark_bridge import lark_bridge

logger = logging.getLogger("lark2agent.api.lark_bridge")

router = APIRouter(prefix="/api/lark", tags=["lark"])


@router.post("/notify")
async def lark_notify(payload: LarkNotifyPayload) -> dict:
    """lark2agent_ws.py 在任务创建/状态变更后调用此接口。

    通知 Web 端通过 WebSocket 推送更新。失败不抛 5xx，避免反向阻塞 Lark Bot。
    """
    try:
        if payload.event_type == "task_created":
            await lark_bridge.on_lark_task_created(payload.data)
        elif payload.event_type in ("task_updated", "task_completed"):
            task_id = payload.task_id or payload.data.get("task_id") or ""
            await lark_bridge.on_lark_task_updated(task_id, payload.data)
        else:
            logger.info("lark_bridge.notify ignored event_type=%s", payload.event_type)
            return {"ok": False, "reason": "unknown_event_type"}
        return {"ok": True}
    except Exception as exc:  # pragma: no cover - 不阻塞调用方
        logger.exception("lark_bridge.notify failed: %s", exc)
        return {"ok": False, "error": str(exc)}


@router.get("/status", response_model=LarkBridgeStatus)
async def lark_status() -> LarkBridgeStatus:
    """查询 Lark Bridge 连接状态。"""
    snapshot = lark_bridge.status()
    return LarkBridgeStatus(**snapshot)
