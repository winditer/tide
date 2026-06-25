"""Hooks 事件驱动 API 路由。

提供 CRUD 接口，路径前缀 ``/api/hooks``。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.core.dependencies import get_optional_user
from backend.services.hook_engine import hook_engine

router = APIRouter(prefix="/api/hooks", tags=["hooks"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


class HookCreate(BaseModel):
    workspace_id: str = "default"
    name: str
    event: str
    action_type: str
    action_config: Any
    conditions: Optional[Any] = None
    priority: Optional[int] = 0
    enabled: Optional[int] = 1


class HookUpdate(BaseModel):
    name: Optional[str] = None
    event: Optional[str] = None
    action_type: Optional[str] = None
    action_config: Optional[Any] = None
    conditions: Optional[Any] = None
    priority: Optional[int] = None
    enabled: Optional[int] = None


class HookResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    event: str
    action_type: str
    action_config: Any = None
    conditions: Optional[Any] = None
    priority: int = 0
    enabled: int = 1
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        extra = "allow"


@router.get("", response_model=list[HookResponse])
async def list_hooks(
    workspace_id: str = Query("default"),
    event: Optional[str] = Query(None),
    enabled: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_optional_user),
):
    items = await hook_engine.list_hooks(
        workspace_id=workspace_id,
        event=event,
        enabled=enabled,
        limit=limit,
        offset=offset,
    )
    return items


@router.get("/{hook_id}", response_model=HookResponse)
async def get_hook(
    hook_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    item = await hook_engine.get_hook(workspace_id, hook_id)
    if not item:
        raise HTTPException(status_code=404, detail="Hook not found")
    return item


@router.post("", response_model=HookResponse)
async def create_hook(
    body: HookCreate,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    try:
        item = await hook_engine.create_hook(
            workspace_id=body.workspace_id,
            data=body.model_dump(exclude={"workspace_id"}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not item:
        raise HTTPException(status_code=500, detail="Failed to create hook")
    return item


@router.put("/{hook_id}", response_model=HookResponse)
async def update_hook(
    hook_id: str,
    body: HookUpdate,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    payload = body.model_dump(exclude_unset=True)
    item = await hook_engine.update_hook(
        workspace_id=workspace_id,
        hook_id=hook_id,
        data=payload,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Hook not found")
    return item


@router.delete("/{hook_id}")
async def delete_hook(
    hook_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    ok = await hook_engine.delete_hook(workspace_id, hook_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Hook not found")
    return {"ok": True}
