"""
Lark 卡片回调 webhook 路由。

POST /api/lark/card-action

Lark 配置「事件订阅 / 卡片回调」时填写本端点：
  https://your-host/api/lark/card-action

请求体格式（节选）:
{
    "type": "url_verification",
    "challenge": "xxx"          # 首次配置时的握手包
}
或:
{
    "open_id": "ou_xxx",
    "user_id": "uid_xxx",
    "open_chat_id": "oc_xxx",
    "open_message_id": "om_xxx",
    "action": {
        "value": {"action": "task_stop_<task_id>"} | "task_stop_<task_id>"
    },
    ...
}

响应格式：
- url_verification 握手：{"challenge": "<challenge>"}
- 其他：{"toast": {...}, "card": {"type": "raw", "data": <card_dict>}}
        或空对象 {} 表示不更新卡片。
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Request

from backend.services.card_action_handler import card_action_handler

logger = logging.getLogger("lark2agent.api.lark_callback")

router = APIRouter(prefix="/api/lark", tags=["lark"])


def _extract_action_value(action_obj: Any) -> str:
    """从 Lark 回调 body['action']['value'] 中提取扁平 action 字符串。

    Lark 端可能传：
    - {"action": "task_stop_<id>"}    （新版 card_builder 格式）
    - "task_stop_<id>"                 （直接字符串）
    - {"action": {...legacy...}}       （兼容旧 dict 格式 → 转 fallback 字符串）
    """
    if action_obj is None:
        return ""
    if isinstance(action_obj, str):
        # 可能是 JSON 字符串
        try:
            parsed = json.loads(action_obj)
        except (TypeError, ValueError, json.JSONDecodeError):
            return action_obj
        return _extract_action_value(parsed)
    if isinstance(action_obj, dict):
        # Lark 标准结构：{"value": {"action": "..."} | "..."}
        if "value" in action_obj:
            return _extract_action_value(action_obj.get("value"))
        # 优先 "action" 键
        inner = action_obj.get("action")
        if isinstance(inner, str):
            return inner
        if isinstance(inner, dict):
            # legacy dict format e.g. {"action": "stop", "task_id": "..."}
            verb = inner.get("action") or ""
            tid = inner.get("task_id") or inner.get("plan_id") or ""
            if verb and tid:
                return f"{verb}_{tid}"
        # 退化：直接平铺 dict（旧版偶尔会这样）
        verb = action_obj.get("verb") or ""
        tid = action_obj.get("id") or ""
        if verb and tid:
            return f"{verb}_{tid}"
    return ""


def _empty_response() -> dict:
    return {}


def _card_response(card_dict: Optional[dict], toast: Optional[dict] = None) -> dict:
    if not card_dict:
        return _empty_response()
    payload: dict = {"card": {"type": "raw", "data": card_dict}}
    if toast:
        payload["toast"] = toast
    return payload


@router.post("/card-action")
async def lark_card_action(request: Request) -> dict:
    """Lark 卡片按钮回调 webhook。"""
    try:
        body: dict = await request.json()
    except Exception:
        logger.warning("lark card-action: invalid JSON body")
        return _empty_response()

    if not isinstance(body, dict):
        return _empty_response()

    # —— 1. URL verification challenge ——
    challenge = body.get("challenge")
    if challenge and body.get("type") == "url_verification":
        logger.info("lark card-action: url_verification challenge received")
        return {"challenge": challenge}

    # 部分版本会用 header.event_type == "url_verification"
    header = body.get("header") or {}
    if header.get("event_type") == "url_verification" and challenge:
        return {"challenge": challenge}

    # —— 2. 解析按钮动作 ——
    action_value = _extract_action_value(body.get("action"))
    if not action_value:
        logger.info("lark card-action: missing action value, body keys=%s",
                    list(body.keys()))
        return _empty_response()

    operator_id = (
        body.get("user_id")
        or body.get("open_id")
        or (body.get("operator") or {}).get("user_id", "")
        or ""
    )
    chat_id = body.get("open_chat_id") or body.get("chat_id") or ""
    message_id = body.get("open_message_id") or body.get("message_id") or ""

    logger.info(
        "lark card-action: action=%s chat=%s msg=%s operator=%s",
        action_value, chat_id[:12], message_id[:12], operator_id[:12],
    )

    # —— 3. 分发到 handler ——
    card = await card_action_handler.handle(
        action_value=action_value,
        operator_id=operator_id,
        chat_id=chat_id,
        message_id=message_id,
    )

    return _card_response(card, toast={"type": "success", "content": "已更新"} if card else None)
