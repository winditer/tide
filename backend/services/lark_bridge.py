"""
LarkBridge: Lark API 发送/更新封装 + Web ↔ Lark 双向同步

功能：
1. 真实 Lark API 发送/更新卡片（基于 lark_oapi SDK）
2. Web → Lark：任务状态变更后，自动重新构建卡片并 patch 已发送的 Lark 消息
3. Lark → Web：新任务/状态变更通过 ws_hub 广播到前端 WebSocket

设计原则：
- lark_oapi 客户端是同步的，所有发送操作通过 asyncio.to_thread 包装为异步
- 未配置 LARK_APP_ID / LARK_APP_SECRET 时 graceful 降级（log warning + return None）
- 任何 Lark API 异常都被捕获并记录，不抛给业务层
- 维护内存映射 task_id → message_id，用于状态变更时 patch 同一张卡片
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.runtime.config import APP_ID, APP_SECRET, LARK_DOMAIN
from backend.services.card_builder import build_task_card
from backend.services.event_emitter import EventTypes
from backend.services.ws_hub import ws_hub

logger = logging.getLogger("lark2agent.lark_bridge")


class LarkBridge:
    """Lark API 发送器 + Web ↔ Lark 双向同步桥接（单例）。"""

    def __init__(self) -> None:
        self.last_event_at: Optional[str] = None
        self.pending_notifications: int = 0
        self._connected: bool = True

        # lark_oapi.Client 实例（懒加载，线程安全）
        self._client: Optional[Any] = None
        self._client_lock = threading.Lock()
        # 串行化 send/patch 调用，避免并发访问同一 SDK client
        self._send_lock = threading.Lock()

        # task_id → 最近一次发送的 Lark message_id（用于后续 patch 同一卡片）
        self._task_message_ids: dict[str, str] = {}

    # ── 配置/客户端 ──────────────────────────────────────

    @property
    def is_configured(self) -> bool:
        """检查 Lark 凭据是否齐全。"""
        return bool(APP_ID and APP_SECRET)

    def _get_client(self) -> Optional[Any]:
        """懒加载 lark_oapi.Client。未配置或导入失败返回 None。"""
        if not self.is_configured:
            return None
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is not None:
                return self._client
            try:
                import lark_oapi as lark  # type: ignore
            except ImportError:
                logger.warning("lark_oapi not installed, Lark API disabled")
                return None
            try:
                self._client = (
                    lark.Client.builder()
                    .app_id(APP_ID)
                    .app_secret(APP_SECRET)
                    .domain(LARK_DOMAIN)
                    .build()
                )
            except Exception:
                logger.exception("failed to build lark_oapi client")
                return None
        return self._client

    def register_message_id(self, task_id: str, message_id: str) -> None:
        """外部注入 task_id → message_id 映射（lark2agent_ws.py 调用）。"""
        if task_id and message_id:
            self._task_message_ids[task_id] = message_id

    def get_message_id(self, task_id: str) -> str:
        return self._task_message_ids.get(task_id, "")

    # ── Lark API（异步包装） ─────────────────────────────

    async def send_card(self, chat_id: str, card_dict: dict) -> Optional[str]:
        """发送交互卡片到 Lark 群/私聊。

        Returns:
            message_id（成功）或 None（未配置 / 失败）。
        """
        if not chat_id or not card_dict:
            logger.warning("send_card skipped: chat_id or card_dict empty")
            return None
        if not self.is_configured:
            logger.warning("send_card skipped: Lark not configured")
            return None
        return await asyncio.to_thread(self._send_card_sync, chat_id, card_dict)

    async def update_card(self, message_id: str, card_dict: dict) -> bool:
        """patch 已发送消息卡片。"""
        if not message_id or not card_dict:
            return False
        if not self.is_configured:
            logger.warning("update_card skipped: Lark not configured")
            return False
        return await asyncio.to_thread(self._update_card_sync, message_id, card_dict)

    async def send_text(self, chat_id: str, text_content: str) -> Optional[str]:
        """发送纯文本消息。"""
        if not chat_id or not text_content:
            return None
        if not self.is_configured:
            logger.warning("send_text skipped: Lark not configured")
            return None
        return await asyncio.to_thread(self._send_text_sync, chat_id, text_content)

    async def reply_text(self, message_id: str, text_content: str) -> Optional[str]:
        """以回复形式发送纯文本消息。"""
        if not message_id or not text_content:
            return None
        if not self.is_configured:
            logger.warning("reply_text skipped: Lark not configured")
            return None
        return await asyncio.to_thread(self._reply_text_sync, message_id, text_content)

    async def send_or_update_card(
        self,
        chat_id: str,
        card_dict: dict,
        existing_message_id: Optional[str] = None,
    ) -> Optional[str]:
        """智能发送/更新：

        - 如果传入 existing_message_id，调用 patch；patch 失败回退到新发送。
        - 否则直接 send_card。
        - 返回最终的 message_id；失败返回 None。
        """
        if existing_message_id:
            ok = await self.update_card(existing_message_id, card_dict)
            if ok:
                return existing_message_id
            logger.info(
                "send_or_update_card: patch failed, fallback to send chat=%s",
                chat_id,
            )
        return await self.send_card(chat_id, card_dict)

    # ── 同步实现（在 to_thread 中调用） ──────────────────

    def _send_card_sync(self, chat_id: str, card_dict: dict) -> Optional[str]:
        client = self._get_client()
        if client is None:
            return None
        try:
            from lark_oapi.api.im.v1 import (  # type: ignore
                CreateMessageRequest,
                CreateMessageRequestBody,
            )
        except ImportError:
            logger.warning("lark_oapi.api.im.v1 not available")
            return None
        try:
            with self._send_lock:
                body = (
                    CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("interactive")
                    .content(json.dumps(card_dict, ensure_ascii=False))
                    .build()
                )
                req = (
                    CreateMessageRequest.builder()
                    .receive_id_type("chat_id")
                    .request_body(body)
                    .build()
                )
                resp = client.im.v1.message.create(req)
            if not _response_ok(resp):
                logger.error(
                    "send_card failed: code=%s msg=%s",
                    getattr(resp, "code", None),
                    getattr(resp, "msg", None),
                )
                return None
            mid = _find_message_id(resp)
            if mid:
                logger.info("send_card ok chat=%s message=%s", chat_id, mid)
            else:
                logger.warning("send_card ok but no message_id parsed")
            return mid or None
        except Exception:
            logger.exception("send_card exception chat=%s", chat_id)
            return None

    def _update_card_sync(self, message_id: str, card_dict: dict) -> bool:
        client = self._get_client()
        if client is None:
            return False
        try:
            from lark_oapi.api.im.v1 import (  # type: ignore
                PatchMessageRequest,
                PatchMessageRequestBody,
            )
        except ImportError:
            logger.warning("lark_oapi.api.im.v1 not available")
            return False
        try:
            with self._send_lock:
                body = (
                    PatchMessageRequestBody.builder()
                    .content(json.dumps(card_dict, ensure_ascii=False))
                    .build()
                )
                req = (
                    PatchMessageRequest.builder()
                    .message_id(message_id)
                    .request_body(body)
                    .build()
                )
                resp = client.im.v1.message.patch(req)
            if not _response_ok(resp):
                logger.error(
                    "update_card failed: code=%s msg=%s",
                    getattr(resp, "code", None),
                    getattr(resp, "msg", None),
                )
                return False
            logger.info("update_card ok message=%s", message_id)
            return True
        except Exception:
            logger.exception("update_card exception message=%s", message_id)
            return False

    def _send_text_sync(self, chat_id: str, text_content: str) -> Optional[str]:
        client = self._get_client()
        if client is None:
            return None
        try:
            from lark_oapi.api.im.v1 import (  # type: ignore
                CreateMessageRequest,
                CreateMessageRequestBody,
            )
        except ImportError:
            return None
        try:
            with self._send_lock:
                body = (
                    CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("text")
                    .content(json.dumps({"text": text_content}, ensure_ascii=False))
                    .build()
                )
                req = (
                    CreateMessageRequest.builder()
                    .receive_id_type("chat_id")
                    .request_body(body)
                    .build()
                )
                resp = client.im.v1.message.create(req)
            if not _response_ok(resp):
                logger.error(
                    "send_text failed: code=%s msg=%s",
                    getattr(resp, "code", None),
                    getattr(resp, "msg", None),
                )
                return None
            return _find_message_id(resp) or None
        except Exception:
            logger.exception("send_text exception chat=%s", chat_id)
            return None

    def _reply_text_sync(self, message_id: str, text_content: str) -> Optional[str]:
        client = self._get_client()
        if client is None:
            return None
        try:
            from lark_oapi.api.im.v1 import (  # type: ignore
                ReplyMessageRequest,
                ReplyMessageRequestBody,
            )
        except ImportError:
            logger.warning("ReplyMessage API not available; falling back to send_text")
            return None
        try:
            with self._send_lock:
                body = (
                    ReplyMessageRequestBody.builder()
                    .content(json.dumps({"text": text_content}, ensure_ascii=False))
                    .msg_type("text")
                    .build()
                )
                req = (
                    ReplyMessageRequest.builder()
                    .message_id(message_id)
                    .request_body(body)
                    .build()
                )
                resp = client.im.v1.message.reply(req)
            if not _response_ok(resp):
                logger.error(
                    "reply_text failed: code=%s msg=%s",
                    getattr(resp, "code", None),
                    getattr(resp, "msg", None),
                )
                return None
            return _find_message_id(resp) or None
        except Exception:
            logger.exception("reply_text exception message=%s", message_id)
            return None

    # ── Web → Lark ───────────────────────────────────────

    async def send_task_card(
        self,
        task_data: dict,
        existing_message_id: Optional[str] = None,
    ) -> Optional[str]:
        """根据任务数据构建卡片并发送/更新。

        - 自动维护 _task_message_ids 映射。
        - 任务无 chat_id 时 skip。
        """
        chat_id = (task_data.get("chat_id") or "").strip()
        task_id = str(task_data.get("id") or task_data.get("task_id") or "")
        if not chat_id:
            return None
        try:
            card = build_task_card(task_data)
        except Exception:
            logger.exception("build_task_card failed task=%s", task_id[:8])
            return None

        message_id = existing_message_id or self.get_message_id(task_id)
        new_mid = await self.send_or_update_card(chat_id, card, message_id)
        if new_mid and task_id:
            self._task_message_ids[task_id] = new_mid
            self.last_event_at = datetime.utcnow().isoformat()
        return new_mid

    async def on_task_status_changed(
        self,
        task_id: str,
        new_status: str,
        source: str = "web",
    ) -> None:
        """Web 端任务状态变更时调用，自动刷新对应 Lark 卡片。"""
        try:
            task = await self._load_task_dict(task_id)
            if not task:
                return
            if not (task.get("chat_id") or "").strip():
                return  # 非 Lark 来源任务

            await self.send_task_card(task)
            logger.info(
                "lark_bridge.web2lark task=%s status=%s source=%s",
                task_id[:8], new_status, source,
            )
        except Exception as exc:  # pragma: no cover - 防御性日志
            logger.warning(
                "lark_bridge.on_task_status_changed failed task=%s err=%s",
                task_id[:8] if task_id else "-", exc,
            )

    # ── Lark → Web ───────────────────────────────────────

    async def on_lark_task_created(self, task_data: dict) -> None:
        """lark2agent_ws.py 创建任务后调用，广播到 WebSocket。"""
        task_id = task_data.get("task_id") or task_data.get("id") or ""
        workspace_id = task_data.get("workspace_id") or "default"
        event = {
            "type": EventTypes.TASK_CREATED,
            "task_id": task_id,
            "workspace_id": workspace_id,
            "source": "lark",
            "data": task_data,
        }
        try:
            await ws_hub.broadcast("tasks", event)
            if task_id:
                await ws_hub.broadcast(f"task:{task_id}", event)
            self.last_event_at = datetime.utcnow().isoformat()
        except Exception as exc:  # pragma: no cover
            logger.warning("lark_bridge.on_lark_task_created failed err=%s", exc)

    async def on_lark_task_updated(self, task_id: str, updates: dict) -> None:
        """lark2agent_ws.py 任务状态变更后调用，广播到 WebSocket。"""
        event = {
            "type": EventTypes.TASK_STATUS_CHANGED,
            "task_id": task_id,
            "source": "lark",
            **updates,
        }
        try:
            await ws_hub.broadcast("tasks", event)
            await ws_hub.broadcast(f"task:{task_id}", event)
            self.last_event_at = datetime.utcnow().isoformat()
        except Exception as exc:  # pragma: no cover
            logger.warning(
                "lark_bridge.on_lark_task_updated failed task=%s err=%s",
                task_id[:8] if task_id else "-", exc,
            )

    # ── status / helpers ─────────────────────────────────

    def status(self) -> dict:
        return {
            "connected": self._connected,
            "configured": self.is_configured,
            "last_event_at": self.last_event_at,
            "pending_notifications": self.pending_notifications,
            "tracked_messages": len(self._task_message_ids),
        }

    async def _load_task_dict(self, task_id: str) -> Optional[dict]:
        """读取任务全量字段（用于重建卡片）。"""
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    text(
                        """
                        SELECT id, workspace_id, plan_id, assignee_id, chat_id,
                               prompt, cwd, model, agent_id, session_id, status,
                               result, started_at, completed_at, duration_ms
                        FROM tasks WHERE id = :task_id
                        """
                    ),
                    {"task_id": task_id},
                )
                row = result.fetchone()
                if not row:
                    return None
                return dict(row._mapping)
        except Exception:  # pragma: no cover
            logger.exception("lark_bridge._load_task_dict failed task=%s", task_id[:8])
            return None


# ── 模块级辅助：response 解析（参考 lark2agent_ws.py） ──────

def _response_ok(resp: Any) -> bool:
    success = getattr(resp, "success", None)
    if callable(success):
        try:
            return bool(success())
        except Exception:
            pass
    if success is not None:
        return bool(success)
    code = getattr(resp, "code", 0)
    return code in (0, None)


def _find_message_id(value: Any, depth: int = 0) -> str:
    """从 SDK response 任意层级中提取 message_id。"""
    if value is None or depth > 4:
        return ""
    if isinstance(value, dict):
        found = value.get("message_id")
        if found:
            return str(found)
        for item in value.values():
            found = _find_message_id(item, depth + 1)
            if found:
                return found
        return ""
    found = getattr(value, "message_id", None)
    if found:
        return str(found)
    for attr in ("data", "body"):
        nested = getattr(value, attr, None)
        if nested is not None:
            found = _find_message_id(nested, depth + 1)
            if found:
                return found
    raw = getattr(value, "__dict__", None)
    if isinstance(raw, dict):
        return _find_message_id(raw, depth + 1)
    return ""


# 全局单例
lark_bridge = LarkBridge()
