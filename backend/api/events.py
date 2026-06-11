"""事件补偿 API — 重连后拉取缺失事件"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from backend.core.dependencies import get_optional_user
from backend.db.engine import async_session_factory

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("")
async def get_events(
    workspace_id: str = Query("default"),
    after: str = Query(None, description="事件 ID，返回此 ID 之后的事件"),
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(get_optional_user),
):
    """获取事件列表（用于重连后补偿）"""
    async with async_session_factory() as session:
        if after:
            # 获取 after 事件的时间戳
            result = await session.execute(
                text("SELECT created_at FROM task_events WHERE id = :id"),
                {"id": after},
            )
            row = result.fetchone()
            if row:
                result = await session.execute(
                    text(
                        "SELECT id, task_id, event_type, payload, created_at "
                        "FROM task_events "
                        "WHERE workspace_id = :ws AND created_at > :after "
                        "ORDER BY created_at ASC LIMIT :limit"
                    ),
                    {"ws": workspace_id, "after": row[0], "limit": limit},
                )
            else:
                result = await session.execute(
                    text(
                        "SELECT id, task_id, event_type, payload, created_at "
                        "FROM task_events "
                        "WHERE workspace_id = :ws "
                        "ORDER BY created_at DESC LIMIT :limit"
                    ),
                    {"ws": workspace_id, "limit": limit},
                )
        else:
            result = await session.execute(
                text(
                    "SELECT id, task_id, event_type, payload, created_at "
                    "FROM task_events "
                    "WHERE workspace_id = :ws "
                    "ORDER BY created_at DESC LIMIT :limit"
                ),
                {"ws": workspace_id, "limit": limit},
            )
        rows = result.fetchall()
        events = [
            {
                "id": r[0],
                "task_id": r[1],
                "event_type": r[2],
                "payload": r[3],
                "created_at": r[4],
            }
            for r in rows
        ]
        return {"events": events}