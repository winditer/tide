"""
Conversations API — 会话管理路由。

- GET  /conversations?workspace_id=  — 会话列表
- GET  /conversations/{id}           — 会话详情
- POST /conversations/{id}/close     — 关闭会话
- PUT  /conversations/{id}           — 更新设置（agent/model）
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.services.conversation_service import conversation_service

router = APIRouter(prefix="/conversations", tags=["conversations"])


class ConversationUpdate(BaseModel):
    agent_id: Optional[str] = None
    model: Optional[str] = None
    cwd: Optional[str] = None


@router.get("")
async def list_conversations(
    workspace_id: str = Query(default="default"),
    status: Optional[str] = Query(default=None),
):
    """会话列表"""
    items = await conversation_service.list_conversations(
        workspace_id=workspace_id,
        status=status,
    )
    return {"items": items, "total": len(items)}


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str):
    """会话详情"""
    conv = await conversation_service.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.post("/{conversation_id}/close")
async def close_conversation(conversation_id: str):
    """关闭会话"""
    conv = await conversation_service.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await conversation_service.close(conversation_id)
    return {"status": "closed", "id": conversation_id}


@router.put("/{conversation_id}")
async def update_conversation(conversation_id: str, body: ConversationUpdate):
    """更新设置（agent/model/cwd）"""
    conv = await conversation_service.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    result = await conversation_service.update_conversation(
        conversation_id=conversation_id,
        agent_id=body.agent_id,
        model=body.model,
        cwd=body.cwd,
    )
    return result
