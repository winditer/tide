"""
Conversations API — 会话管理路由。

- GET  /conversations?workspace_id=  — 会话列表
- GET  /conversations/{id}           — 会话详情
- POST /conversations/{id}/close     — 关闭会话
- PUT  /conversations/{id}           — 更新设置（agent/model）
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.core.dependencies import (
    check_cwd_write_permission,
    encode_project_id,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.services.conversation_service import conversation_service

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


class ConversationUpdate(BaseModel):
    agent_id: Optional[str] = None
    model: Optional[str] = None
    cwd: Optional[str] = None


@router.get("")
async def list_conversations(
    workspace_id: str = Query(default="default"),
    status: Optional[str] = Query(default=None),
    current_user=Depends(get_optional_user),
):
    """会话列表"""
    accessible_pids = await get_accessible_project_ids(current_user)
    items = await conversation_service.list_conversations(
        workspace_id=workspace_id,
        status=status,
    )
    if accessible_pids is not None:
        items = [
            it for it in items
            if encode_project_id(it.get("cwd") or "") in accessible_pids
        ]
    return {"items": items, "total": len(items)}


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    current_user=Depends(get_optional_user),
):
    """会话详情"""
    conv = await conversation_service.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.post("/{conversation_id}/close")
async def close_conversation(
    conversation_id: str,
    current_user=Depends(get_optional_user),
):
    """关闭会话"""
    _ensure_not_viewer(current_user)
    conv = await conversation_service.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await check_cwd_write_permission(conv.get("cwd"), current_user)
    await conversation_service.close(conversation_id)
    return {"status": "closed", "id": conversation_id}


@router.put("/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    body: ConversationUpdate,
    current_user=Depends(get_optional_user),
):
    """更新设置（agent/model/cwd）"""
    _ensure_not_viewer(current_user)
    conv = await conversation_service.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    # 可访问原项目且可访问目标项目都需不是 viewer
    await check_cwd_write_permission(conv.get("cwd"), current_user)
    if body.cwd and body.cwd != conv.get("cwd"):
        await check_cwd_write_permission(body.cwd, current_user)

    result = await conversation_service.update_conversation(
        conversation_id=conversation_id,
        agent_id=body.agent_id,
        model=body.model,
        cwd=body.cwd,
    )
    return result
