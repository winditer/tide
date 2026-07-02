"""Skills 知识库 API 路由。

提供 CRUD 接口，路径前缀 ``/api/skills``。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.dependencies import check_project_config_permission, get_optional_user
from backend.services.skill_service import skill_service

router = APIRouter(prefix="/api/skills", tags=["skills"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


class SkillCreate(BaseModel):
    workspace_id: str = "default"
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = "general"
    tags: Optional[Any] = None  # list[str] | str | None
    content: str
    enabled: Optional[int] = 1
    source: Optional[str] = "custom"
    project_id: Optional[str] = None


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[Any] = None
    content: Optional[str] = None
    enabled: Optional[int] = None
    source: Optional[str] = None
    project_id: Optional[str] = None


class SkillResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    slug: str
    description: Optional[str] = None
    category: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    content: str
    version: int = 1
    enabled: int = 1
    source: Optional[str] = None
    project_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        extra = "allow"


@router.get("", response_model=list[SkillResponse])
async def list_skills(
    workspace_id: str = Query("default"),
    category: Optional[str] = Query(None),
    enabled: Optional[int] = Query(None),
    project_id: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_optional_user),
):
    enabled_only = True
    if enabled is not None:
        enabled_only = bool(enabled)
    items = await skill_service.list_skills(
        workspace_id=workspace_id,
        category=category,
        enabled_only=enabled_only,
        project_id=project_id,
        limit=limit,
        offset=offset,
    )
    return items


@router.get("/{skill_id}", response_model=SkillResponse)
async def get_skill(
    skill_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    item = await skill_service.get_skill(workspace_id, skill_id)
    if not item:
        raise HTTPException(status_code=404, detail="Skill not found")
    return item


@router.post("", response_model=SkillResponse)
async def create_skill(
    body: SkillCreate,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    await check_project_config_permission(body.project_id, current_user)
    try:
        item = await skill_service.create_skill(
            workspace_id=body.workspace_id,
            data=body.model_dump(exclude={"workspace_id"}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not item:
        raise HTTPException(status_code=500, detail="Failed to create skill")
    return item


@router.put("/{skill_id}", response_model=SkillResponse)
async def update_skill(
    skill_id: str,
    body: SkillUpdate,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    await check_project_config_permission(body.project_id, current_user)
    payload = body.model_dump(exclude_unset=True)
    item = await skill_service.update_skill(
        workspace_id=workspace_id,
        skill_id=skill_id,
        data=payload,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Skill not found")
    return item


@router.delete("/{skill_id}")
async def delete_skill(
    skill_id: str,
    workspace_id: str = Query("default"),
    project_id: Optional[str] = Query(None),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    await check_project_config_permission(project_id, current_user)
    ok = await skill_service.delete_skill(workspace_id, skill_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"ok": True}
