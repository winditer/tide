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


notification_service = NotificationService()
