"""Rules 规则引擎 API 路由。

提供 CRUD 接口，路径前缀 ``/api/rules``。
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.core.dependencies import get_optional_user
from backend.services.rule_service import rule_service

router = APIRouter(prefix="/api/rules", tags=["rules"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


class RuleCreate(BaseModel):
    workspace_id: str = "default"
    name: str
    scope: Optional[str] = "global"
    scope_value: Optional[str] = None
    project_id: Optional[str] = None
    content: str
    priority: Optional[int] = 0
    enabled: Optional[int] = 1
    source: Optional[str] = "custom"


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    scope: Optional[str] = None
    scope_value: Optional[str] = None
    project_id: Optional[str] = None
    content: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[int] = None
    source: Optional[str] = None


class RuleResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    scope: Optional[str] = "global"
    scope_value: Optional[str] = None
    project_id: Optional[str] = None
    content: str
    priority: int = 0
    enabled: int = 1
    source: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        extra = "allow"


@router.get("", response_model=list[RuleResponse])
async def list_rules(
    workspace_id: str = Query("default"),
    scope: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_optional_user),
):
    items = await rule_service.list_rules(
        workspace_id=workspace_id,
        scope=scope,
        project_id=project_id,
        limit=limit,
        offset=offset,
    )
    return items


@router.get("/{rule_id}", response_model=RuleResponse)
async def get_rule(
    rule_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    item = await rule_service.get_rule(workspace_id, rule_id)
    if not item:
        raise HTTPException(status_code=404, detail="Rule not found")
    return item


@router.post("", response_model=RuleResponse)
async def create_rule(
    body: RuleCreate,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    try:
        item = await rule_service.create_rule(
            workspace_id=body.workspace_id,
            data=body.model_dump(exclude={"workspace_id"}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not item:
        raise HTTPException(status_code=500, detail="Failed to create rule")
    return item


@router.put("/{rule_id}", response_model=RuleResponse)
async def update_rule(
    rule_id: str,
    body: RuleUpdate,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    payload = body.model_dump(exclude_unset=True)
    item = await rule_service.update_rule(
        workspace_id=workspace_id,
        rule_id=rule_id,
        data=payload,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Rule not found")
    return item


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    ok = await rule_service.delete_rule(workspace_id, rule_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}
