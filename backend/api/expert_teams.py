"""Expert Teams 专家团 API 路由。

提供 CRUD 接口，路径前缀 ``/api/expert-teams``。
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.dependencies import get_optional_user, check_project_config_permission
from backend.services.expert_team_service import expert_team_service

router = APIRouter(prefix="/api/expert-teams", tags=["expert-teams"])


class ExpertTeamCreate(BaseModel):
    workspace_id: str = "default"
    project_id: Optional[str] = None
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    agent_id: str
    model: Optional[str] = None
    skill_slugs: list[str] = Field(default_factory=list)
    role_prompt: Optional[str] = None
    enabled: Optional[int] = 1


class ExpertTeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    agent_id: Optional[str] = None
    model: Optional[str] = None
    skill_slugs: Optional[list[str]] = None
    role_prompt: Optional[str] = None
    enabled: Optional[int] = None
    project_id: Optional[str] = None


class ExpertTeamResponse(BaseModel):
    id: str
    workspace_id: str
    project_id: Optional[str] = None
    name: str
    slug: str
    description: Optional[str] = None
    agent_id: str
    model: Optional[str] = None
    skill_slugs: list[str] = Field(default_factory=list)
    role_prompt: Optional[str] = None
    enabled: int = 1
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        extra = "allow"


@router.get("", response_model=list[ExpertTeamResponse])
async def list_expert_teams(
    workspace_id: str = Query("default"),
    project_id: Optional[str] = Query(None),
    enabled: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_optional_user),
):
    items = await expert_team_service.list_expert_teams(
        workspace_id=workspace_id,
        project_id=project_id,
        enabled=enabled,
        limit=limit,
        offset=offset,
    )
    return items


@router.get("/{team_id}", response_model=ExpertTeamResponse)
async def get_expert_team(
    team_id: str,
    current_user=Depends(get_optional_user),
):
    item = await expert_team_service.get_expert_team(team_id)
    if not item:
        raise HTTPException(status_code=404, detail="Expert team not found")
    return item


@router.post("", response_model=ExpertTeamResponse)
async def create_expert_team(
    body: ExpertTeamCreate,
    current_user=Depends(get_optional_user),
):
    await check_project_config_permission(body.project_id, current_user)
    try:
        item = await expert_team_service.create_expert_team(
            workspace_id=body.workspace_id,
            data=body.model_dump(exclude={"workspace_id"}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not item:
        raise HTTPException(status_code=500, detail="Failed to create expert team")
    return item


@router.put("/{team_id}", response_model=ExpertTeamResponse)
async def update_expert_team(
    team_id: str,
    body: ExpertTeamUpdate,
    current_user=Depends(get_optional_user),
):
    existing = await expert_team_service.get_expert_team(team_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Expert team not found")
    # 检查权限：使用现有记录的 project_id 或更新中的 project_id
    project_id = body.project_id if body.project_id is not None else existing.get("project_id")
    await check_project_config_permission(project_id, current_user)
    payload = body.model_dump(exclude_unset=True)
    item = await expert_team_service.update_expert_team(
        team_id=team_id,
        data=payload,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Expert team not found")
    return item


@router.delete("/{team_id}")
async def delete_expert_team(
    team_id: str,
    current_user=Depends(get_optional_user),
):
    existing = await expert_team_service.get_expert_team(team_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Expert team not found")
    await check_project_config_permission(existing.get("project_id"), current_user)
    ok = await expert_team_service.delete_expert_team(team_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Expert team not found")
    return {"ok": True}
