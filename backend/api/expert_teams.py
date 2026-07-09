"""Expert Teams 专家团 API 路由。

提供 CRUD 接口，路径前缀 ``/api/expert-teams``。
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from backend.core.dependencies import get_optional_user, check_project_config_permission
from backend.core.scope_utils import match_project_scope
from backend.db.engine import async_session_factory
from backend.services.agent_config_service import agent_config_service
from backend.services.expert_team_service import expert_team_service

router = APIRouter(prefix="/api/expert-teams", tags=["expert-teams"])


def _is_personal_scope(project_id) -> bool:
    """判断作用域是否为个人作用域（project_id 以 ``personal:`` 前缀存储）。"""
    return isinstance(project_id, str) and project_id.startswith("personal:")


async def _check_permission(project_id, current_user) -> None:
    """专家团作用域权限校验。

    - 个人作用域（personal:<uid>）：仅归属用户本人或全局 admin 可管理
    - 其余（全局 / 项目 / 项目组）：委托 check_project_config_permission
    """
    if _is_personal_scope(project_id):
        if not current_user:
            return  # TIDE_REQUIRE_AUTH=0 时放行
        if current_user.get("role") == "admin":
            return
        owner_id = project_id.split(":", 1)[1]
        if owner_id == current_user.get("id"):
            return
        raise HTTPException(status_code=403, detail="无权管理他人的个人专家团")
    await check_project_config_permission(project_id, current_user)


def _collect_disabled_agents(configs: dict) -> set:
    """从合并后的 agent_configs 中提取被显式禁用（enabled=0）的 agent_id 集合。"""
    return {aid for aid, cfg in configs.items() if cfg.get("enabled") == 0}


def _is_team_agent_available(team: dict, disabled: set) -> bool:
    """判断专家团/小队的底层 Agent 是否至少有一个可用。

    - 普通专家团：agent_id 被禁用则不可用
    - 小队（is_squad）：member_agents 中全部成员被禁用才不可用；
      member_agents 为空时回退到主 agent_id 判断
    """
    if team.get("is_squad"):
        member_ids = [
            m.get("agent_id")
            for m in (team.get("member_agents") or [])
            if m.get("agent_id")
        ]
        if member_ids:
            return any(mid not in disabled for mid in member_ids)
    agent_id = team.get("agent_id")
    return agent_id not in disabled if agent_id else True


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
    member_agents: list[dict] = Field(default_factory=list)
    is_squad: Optional[int] = 0
    leader_strategy: Optional[str] = "capability_match"
    enabled: Optional[int] = 1


class ExpertTeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    agent_id: Optional[str] = None
    model: Optional[str] = None
    skill_slugs: Optional[list[str]] = None
    role_prompt: Optional[str] = None
    member_agents: Optional[list[dict]] = None
    is_squad: Optional[int] = None
    leader_strategy: Optional[str] = None
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
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        extra = "allow"


@router.get("", response_model=list[ExpertTeamResponse])
async def list_expert_teams(
    workspace_id: str = Query("default"),
    project_id: Optional[str] = Query(None),
    enabled: Optional[int] = Query(None),
    exclude_disabled_agents: bool = Query(
        False,
        description="为 true 时过滤掉底层 Agent 已禁用的专家团/小队（供工作流配置、"
        "@mention 等选择场景使用；管理页展示全量时不传此参数）。",
    ),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_optional_user),
):
    # 拉取全量（不在 SQL 层按 project 过滤），随后用 match_project_scope 做
    # 作用域过滤，以支持多选项目及项目组（project_id 可能是单值/JSON 数组/group: 前缀）。
    items = await expert_team_service.list_expert_teams(
        workspace_id=workspace_id,
        project_id=None,
        enabled=enabled,
        limit=limit,
        offset=offset,
    )
    # 按项目作用域过滤（兼容多选 + 项目组）
    if project_id:
        project_group_ids: set = set()
        try:
            async with async_session_factory() as session:
                rows = await session.execute(
                    text(
                        "SELECT group_id FROM project_group_members WHERE project_id = :pid"
                    ),
                    {"pid": project_id},
                )
                project_group_ids = {r[0] for r in rows.fetchall()}
        except Exception:  # noqa: BLE001 - 降级：查询失败时不做组匹配
            pass
        items = [
            t
            for t in items
            if match_project_scope(t.get("project_id"), project_id, project_group_ids)
        ]
    # 过滤底层 Agent 被禁用的专家团/小队（基于 agent_configs 三级作用域合并）
    if exclude_disabled_agents and items:
        try:
            user_id = current_user.get("id") if current_user else None
            configs = await agent_config_service.resolve_configs(
                user_id=user_id,
                project_id=project_id,
                workspace_id=workspace_id,
            )
            disabled = _collect_disabled_agents(configs)
            if disabled:
                items = [t for t in items if _is_team_agent_available(t, disabled)]
        except Exception:  # noqa: BLE001 - 降级：解析失败时不过滤
            pass
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
    await _check_permission(body.project_id, current_user)
    try:
        data = body.model_dump(exclude={"workspace_id"})
        data["created_by"] = current_user.get("id") if current_user else None
        item = await expert_team_service.create_expert_team(
            workspace_id=body.workspace_id,
            data=data,
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
    await _check_permission(project_id, current_user)
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
    await _check_permission(existing.get("project_id"), current_user)
    ok = await expert_team_service.delete_expert_team(team_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Expert team not found")
    return {"ok": True}
