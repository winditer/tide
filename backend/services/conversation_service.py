"""
ConversationService — 会话管理持久化服务。

将 message_handler 的内存 _chat_state 替换为 SQLite 持久化，
支持 session resume、Agent/Model 切换等。
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.conversation_service")


class ConversationService:
    """会话管理服务"""

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    async def get_or_create(
        self,
        workspace_id: str,
        chat_id: Optional[str] = None,
    ) -> dict:
        """获取现有会话或创建新会话，返回会话信息 dict。

        优先通过 chat_id 查找已有活跃会话（Lark 场景）；
        如果没有 chat_id 或未找到，则创建新会话。
        """
        async with async_session_factory() as session:
            # 如果有 chat_id，尝试查找已有活跃会话
            if chat_id:
                result = await session.execute(
                    text("""
                    SELECT id, workspace_id, chat_id, agent_id, model,
                           session_id, cwd, status, last_active_at, created_at, metadata
                    FROM conversations
                    WHERE workspace_id = :workspace_id
                      AND chat_id = :chat_id
                      AND status != 'closed'
                    ORDER BY last_active_at DESC
                    LIMIT 1
                    """),
                    {"workspace_id": workspace_id, "chat_id": chat_id},
                )
                row = result.fetchone()
                if row:
                    conv = dict(row._mapping)
                    # touch last_active_at
                    await session.execute(
                        text("""
                        UPDATE conversations
                        SET last_active_at = :now, status = 'active'
                        WHERE id = :conv_id
                        """),
                        {"now": self._now_iso(), "conv_id": conv["id"]},
                    )
                    await session.commit()
                    conv["status"] = "active"
                    return conv

            # 创建新会话
            conv_id = str(uuid.uuid4())
            now = self._now_iso()
            await session.execute(
                text("""
                INSERT INTO conversations
                    (id, workspace_id, chat_id, agent_id, model, status, last_active_at, created_at, metadata)
                VALUES
                    (:id, :workspace_id, :chat_id, 'codex', '', 'active', :now, :now, '{}')
                """),
                {
                    "id": conv_id,
                    "workspace_id": workspace_id,
                    "chat_id": chat_id,
                    "now": now,
                },
            )
            await session.commit()

            return {
                "id": conv_id,
                "workspace_id": workspace_id,
                "chat_id": chat_id,
                "agent_id": "codex",
                "model": "",
                "session_id": None,
                "cwd": None,
                "status": "active",
                "last_active_at": now,
                "created_at": now,
                "metadata": "{}",
            }

    async def update_session(self, conversation_id: str, session_id: str) -> None:
        """记录 Agent session ID（任务执行时产出）"""
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE conversations
                SET session_id = :session_id,
                    last_active_at = :now,
                    status = 'active'
                WHERE id = :conv_id
                """),
                {
                    "session_id": session_id,
                    "now": self._now_iso(),
                    "conv_id": conversation_id,
                },
            )
            await session.commit()
        logger.debug(
            "Conversation %s session updated: %s",
            conversation_id[:8], session_id[:8] if session_id else "-",
        )

    async def get_active_session(self, conversation_id: str) -> Optional[str]:
        """获取活跃 session_id（用于 resume），如果会话 idle/closed 返回 None"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT session_id, status
                FROM conversations
                WHERE id = :conv_id
                """),
                {"conv_id": conversation_id},
            )
            row = result.fetchone()
            if not row:
                return None
            data = dict(row._mapping)
            if data["status"] in ("closed",):
                return None
            return data["session_id"] or None

    async def set_agent(self, conversation_id: str, agent_id: str) -> None:
        """切换 Agent"""
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE conversations
                SET agent_id = :agent_id, last_active_at = :now
                WHERE id = :conv_id
                """),
                {
                    "agent_id": agent_id,
                    "now": self._now_iso(),
                    "conv_id": conversation_id,
                },
            )
            await session.commit()
        logger.info("Conversation %s agent set to: %s", conversation_id[:8], agent_id)

    async def set_model(self, conversation_id: str, model: str) -> None:
        """切换 Model"""
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE conversations
                SET model = :model, last_active_at = :now
                WHERE id = :conv_id
                """),
                {
                    "model": model,
                    "now": self._now_iso(),
                    "conv_id": conversation_id,
                },
            )
            await session.commit()
        logger.info("Conversation %s model set to: %s", conversation_id[:8], model)

    async def close(self, conversation_id: str) -> None:
        """关闭会话"""
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE conversations
                SET status = 'closed', last_active_at = :now
                WHERE id = :conv_id
                """),
                {"now": self._now_iso(), "conv_id": conversation_id},
            )
            await session.commit()
        logger.info("Conversation %s closed", conversation_id[:8])

    async def touch(self, conversation_id: str) -> None:
        """更新 last_active_at"""
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE conversations
                SET last_active_at = :now
                WHERE id = :conv_id
                """),
                {"now": self._now_iso(), "conv_id": conversation_id},
            )
            await session.commit()

    async def list_conversations(
        self,
        workspace_id: str,
        status: Optional[str] = None,
    ) -> list[dict]:
        """列出会话"""
        conditions = ["workspace_id = :workspace_id"]
        params: dict = {"workspace_id": workspace_id}

        if status:
            conditions.append("status = :status")
            params["status"] = status

        where = " AND ".join(conditions)

        async with async_session_factory() as session:
            result = await session.execute(
                text(f"""
                SELECT id, workspace_id, chat_id, agent_id, model,
                       session_id, cwd, status, last_active_at, created_at, metadata
                FROM conversations
                WHERE {where}
                ORDER BY last_active_at DESC
                """),
                params,
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]

    async def get_conversation(self, conversation_id: str) -> Optional[dict]:
        """获取单个会话详情"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, workspace_id, chat_id, agent_id, model,
                       session_id, cwd, status, last_active_at, created_at, metadata
                FROM conversations
                WHERE id = :conv_id
                """),
                {"conv_id": conversation_id},
            )
            row = result.fetchone()
            if not row:
                return None
            return dict(row._mapping)

    async def update_conversation(
        self,
        conversation_id: str,
        agent_id: Optional[str] = None,
        model: Optional[str] = None,
        cwd: Optional[str] = None,
    ) -> Optional[dict]:
        """更新会话设置（agent/model/cwd）"""
        sets = ["last_active_at = :now"]
        params: dict = {"now": self._now_iso(), "conv_id": conversation_id}

        if agent_id is not None:
            sets.append("agent_id = :agent_id")
            params["agent_id"] = agent_id
        if model is not None:
            sets.append("model = :model")
            params["model"] = model
        if cwd is not None:
            sets.append("cwd = :cwd")
            params["cwd"] = cwd

        async with async_session_factory() as session:
            await session.execute(
                text(f"UPDATE conversations SET {', '.join(sets)} WHERE id = :conv_id"),
                params,
            )
            await session.commit()

        return await self.get_conversation(conversation_id)


# 全局单例
conversation_service = ConversationService()
