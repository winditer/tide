"""站内通知服务。

提供通知的创建（含 WebSocket 实时推送）、查询、未读计数与已读标记能力。
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.ws_hub import ws_hub


class NotificationService:
    async def create_notification(
        self,
        recipient_id,
        work_item_id,
        notification_type,
        trigger_actor_id=None,
        content="",
    ):
        """创建通知并通过 WebSocket 推送"""
        nid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        async with async_session_factory() as session:
            await session.execute(
                text("""
                    INSERT INTO notifications (id, recipient_id, work_item_id, notification_type, trigger_actor_id, content, created_at)
                    VALUES (:id, :rid, :wid, :type, :actor, :content, :ts)
                """),
                {
                    "id": nid,
                    "rid": recipient_id,
                    "wid": work_item_id,
                    "type": notification_type,
                    "actor": trigger_actor_id,
                    "content": content,
                    "ts": now,
                },
            )
            await session.commit()
        # 实时推送
        event = {
            "type": "notification.created",
            "id": nid,
            "recipient_id": recipient_id,
            "work_item_id": work_item_id,
            "notification_type": notification_type,
            "content": content,
            "created_at": now,
        }
        await ws_hub.broadcast(f"notifications:{recipient_id}", event)
        return nid

    async def get_notifications(self, user_id, limit=20, unread_only=False):
        condition = "WHERE recipient_id = :uid"
        if unread_only:
            condition += " AND is_read = 0"
        async with async_session_factory() as session:
            result = await session.execute(
                text(f"""
                    SELECT id, recipient_id, work_item_id, notification_type, trigger_actor_id, content, is_read, created_at
                    FROM notifications {condition}
                    ORDER BY created_at DESC LIMIT :lim
                """),
                {"uid": user_id, "lim": limit},
            )
            rows = result.fetchall()
        return [
            dict(
                zip(
                    [
                        "id",
                        "recipient_id",
                        "work_item_id",
                        "notification_type",
                        "trigger_actor_id",
                        "content",
                        "is_read",
                        "created_at",
                    ],
                    r,
                )
            )
            for r in rows
        ]

    async def get_unread_count(self, user_id):
        async with async_session_factory() as session:
            result = await session.execute(
                text("SELECT COUNT(*) FROM notifications WHERE recipient_id = :uid AND is_read = 0"),
                {"uid": user_id},
            )
            return result.scalar() or 0

    async def mark_as_read(self, notification_id, user_id):
        async with async_session_factory() as session:
            await session.execute(
                text("UPDATE notifications SET is_read = 1 WHERE id = :nid AND recipient_id = :uid"),
                {"nid": notification_id, "uid": user_id},
            )
            await session.commit()

    async def mark_all_as_read(self, user_id):
        async with async_session_factory() as session:
            await session.execute(
                text("UPDATE notifications SET is_read = 1 WHERE recipient_id = :uid AND is_read = 0"),
                {"uid": user_id},
            )
            await session.commit()

    async def send_lark_mention_notification(
        self,
        recipient_id: str,
        work_item_id: str,
        actor_name: str,
        comment_content: str,
    ):
        """向被@用户发送Lark卡片通知（异步，失败不影响主流程）。"""
        try:
            import json as _json
            import os

            from backend.services.lark_bridge import lark_bridge
            from backend.services.card_builder import build_mention_notification_card

            # 1. 查询用户的 lark_open_id 和 notification_prefs
            async with async_session_factory() as session:
                result = await session.execute(
                    text(
                        "SELECT lark_open_id, notification_prefs FROM users WHERE id = :uid LIMIT 1"
                    ),
                    {"uid": recipient_id},
                )
                row = result.fetchone()
            if not row:
                return

            lark_open_id = row[0]
            if not lark_open_id:
                return  # 用户未绑定Lark

            # 2. 检查通知偏好（默认启用）
            prefs_raw = row[1]
            prefs = {}
            if prefs_raw:
                try:
                    prefs = _json.loads(prefs_raw) if isinstance(prefs_raw, str) else prefs_raw
                except (_json.JSONDecodeError, TypeError):
                    pass
            if not prefs.get("lark_mention_enabled", True):
                return  # 用户已关闭Lark@提及通知

            # 3. 查询工作项标题和项目名
            async with async_session_factory() as session:
                result = await session.execute(
                    text(
                        "SELECT wi.title, p.name FROM work_items wi "
                        "LEFT JOIN project_groups p ON wi.project_id = p.id "
                        "WHERE wi.id = :wid LIMIT 1"
                    ),
                    {"wid": work_item_id},
                )
                wi_row = result.fetchone()

            wi_title = (wi_row[0] if wi_row else None) or work_item_id
            project_name = (wi_row[1] if wi_row else None) or ""

            # 4. 构造URL
            base_url = os.environ.get("FRONTEND_BASE_URL", "")
            work_item_url = f"{base_url}/work-items?detail={work_item_id}"

            # 5. 构建卡片并发送
            card = build_mention_notification_card(
                actor_name=actor_name,
                work_item_title=wi_title,
                comment_content=comment_content,
                work_item_url=work_item_url,
                project_name=project_name,
            )
            await lark_bridge.send_card_to_user(lark_open_id, card)
        except Exception:
            import logging
            logging.getLogger("tide.notification").error(
                "send_lark_mention_notification failed", exc_info=True
            )


notification_service = NotificationService()
