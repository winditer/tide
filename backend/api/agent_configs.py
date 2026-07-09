"""
Agent 配置管理 API。

提供 Agent 配置覆盖层的 CRUD 接口，支持全局 / 项目 / 个人三级作用域。
路径前缀 ``/api/agent-configs``。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.dependencies import (
    check_project_config_permission,
    get_optional_user,
)
from backend.services.agent_config_service import agent_config_service

router = APIRouter(prefix="/api/agent-configs", tags=["agent-configs"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class AgentConfigCreate(BaseModel):
    workspace_id: str = "default"
    agent_id: str
    scope: str = "global"
    scope_target: Optional[str] = None
    enabled: Optional[int] = 1
    display_name: Optional[str] = None
    description: Optional[str] = None
    model_override: Optional[str] = None
    timeout_override: Optional[int] = None
    config_json: Optional[Any] = None


class AgentConfigUpdate(BaseModel):
    enabled: Optional[int] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    model_override: Optional[str] = None
    timeout_override: Optional[int] = None
    scope: Optional[str] = None
    scope_target: Optional[str] = None
    config_json: Optional[Any] = None


class AgentConfigToggle(BaseModel):
    enabled: int = Field(ge=0, le=1)


class AgentConfigBatch(BaseModel):
    workspace_id: str = "default"
    agent_id: str
    scope: str = "project"
    scope_targets: list[str]  # ["proj-a", "group:grp-1", ...]
    display_name: Optional[str] = None
    description: Optional[str] = None
    model_override: Optional[str] = None
    timeout_override: Optional[int] = None
    config_json: Optional[dict] = None


class AgentConfigResponse(BaseModel):
    id: str
    workspace_id: str
    agent_id: str
    scope: str
    scope_target: Optional[str] = None
    enabled: int
    display_name: Optional[str] = None
    description: Optional[str] = None
    model_override: Optional[str] = None
    timeout_override: Optional[int] = None
    config_json: Optional[Any] = None
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        extra = "allow"


# ---------------------------------------------------------------------------
# Permission helpers
# ---------------------------------------------------------------------------


async def _check_scope_permission(
    scope: str,
    scope_target: Optional[str],
    current_user: Optional[dict],
) -> None:
    """根据 scope 执行对应的权限检查。"""
    if not current_user:
        return  # TIDE_REQUIRE_AUTH=0 时放行
    if scope == "global":
        await check_project_config_permission(None, current_user)
    elif scope == "project":
        await check_project_config_permission(scope_target, current_user)
    elif scope == "personal":
        # 用户自己或 admin
        if current_user.get("role") == "admin":
            return
        if scope_target and scope_target != current_user.get("id"):
            raise HTTPException(status_code=403, detail="仅可管理个人配置")
    else:
        raise HTTPException(status_code=400, detail=f"Invalid scope: {scope}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/available", response_model=list[AgentConfigResponse])
async def available_agent_configs(
    workspace_id: str = Query("default"),
    project_id: Optional[str] = Query(None),
    current_user=Depends(get_optional_user),
):
    """返回当前上下文下合并后的 Agent 配置列表。"""
    user_id = current_user.get("id") if current_user else None
    configs = await agent_config_service.resolve_configs(
        user_id=user_id,
        project_id=project_id,
        workspace_id=workspace_id,
    )
    return list(configs.values())


@router.get("", response_model=list[AgentConfigResponse])
async def list_agent_configs(
    workspace_id: str = Query("default"),
    scope: Optional[str] = Query(None),
    scope_target: Optional[str] = Query(None),
    agent_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_optional_user),
):
    """查询 Agent 配置列表，支持按 scope / scope_target / agent_id 筛选。"""
    items = await agent_config_service.list_configs(
        workspace_id=workspace_id,
        scope=scope,
        scope_target=scope_target,
        agent_id=agent_id,
        limit=limit,
        offset=offset,
    )
    return items


@router.post("/batch")
async def batch_agent_configs(
    body: AgentConfigBatch,
    current_user=Depends(get_optional_user),
):
    """批量管理项目作用域配置：根据 scope_targets 创建/删除/更新配置。"""
    _ensure_not_viewer(current_user)

    workspace_id = body.workspace_id
    agent_id = body.agent_id
    new_targets = set(body.scope_targets)

    # 获取该 agent 现有的所有 project-scope 配置
    existing_configs = await agent_config_service.list_configs(
        workspace_id=workspace_id,
        scope="project",
        agent_id=agent_id,
        limit=500,
    )

    existing_map: dict[str, dict] = {}
    for cfg in existing_configs:
        target = cfg.get("scope_target")
        if target:
            existing_map[target] = cfg

    existing_targets = set(existing_map.keys())

    # 计算差集
    to_create = new_targets - existing_targets
    to_delete = existing_targets - new_targets
    to_update = new_targets & existing_targets

    created_ids = []
    deleted_ids = []
    updated_ids = []

    # 公共字段
    common_data = {}
    if body.display_name is not None:
        common_data["display_name"] = body.display_name
    if body.description is not None:
        common_data["description"] = body.description
    if body.model_override is not None:
        common_data["model_override"] = body.model_override
    if body.timeout_override is not None:
        common_data["timeout_override"] = body.timeout_override
    if body.config_json is not None:
        common_data["config_json"] = body.config_json

    # 创建新配置
    for target in to_create:
        data = {
            "agent_id": agent_id,
            "scope": "project",
            "scope_target": target,
            "enabled": 1,
            **common_data,
        }
        if current_user:
            data["created_by"] = current_user.get("id")
        try:
            item = await agent_config_service.create_config(
                workspace_id=workspace_id,
                data=data,
            )
            created_ids.append(item.get("id"))
        except ValueError:
            pass  # 可能已存在，忽略

    # 删除移除的配置
    for target in to_delete:
        cfg = existing_map[target]
        config_id = cfg.get("id")
        if config_id:
            await agent_config_service.delete_config(config_id)
            deleted_ids.append(config_id)

    # 更新保留的配置（同步公共字段）
    if common_data:
        for target in to_update:
            cfg = existing_map[target]
            config_id = cfg.get("id")
            if config_id:
                await agent_config_service.update_config(config_id, common_data)
                updated_ids.append(config_id)

    return {
        "ok": True,
        "created": len(created_ids),
        "deleted": len(deleted_ids),
        "updated": len(updated_ids),
    }


@router.get("/{config_id}", response_model=AgentConfigResponse)
async def get_agent_config(
    config_id: str,
    current_user=Depends(get_optional_user),
):
    item = await agent_config_service.get_config(config_id)
    if not item:
        raise HTTPException(status_code=404, detail="Agent config not found")
    return item


@router.post("", response_model=AgentConfigResponse)
async def create_agent_config(
    body: AgentConfigCreate,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    await _check_scope_permission(body.scope, body.scope_target, current_user)

    data = body.model_dump(exclude={"workspace_id"})
    if current_user:
        data["created_by"] = current_user.get("id")

    try:
        item = await agent_config_service.create_config(
            workspace_id=body.workspace_id,
            data=data,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return item


@router.put("/{config_id}", response_model=AgentConfigResponse)
async def update_agent_config(
    config_id: str,
    body: AgentConfigUpdate,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)

    existing = await agent_config_service.get_config(config_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Agent config not found")

    # 创建者/admin 放行
    if current_user:
        if current_user.get("role") == "admin":
            pass  # admin 直接放行，跳过 scope 权限检查
        elif existing.get("created_by") and existing.get("created_by") == current_user.get("id"):
            pass  # 创建者放行
        else:
            # 其他用户执行原有 scope 权限检查
            await _check_scope_permission(
                existing.get("scope", "global"),
                existing.get("scope_target"),
                current_user,
            )
    # 如果没有 current_user（无认证模式），直接放行

    data = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        item = await agent_config_service.update_config(config_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not item:
        raise HTTPException(status_code=404, detail="Agent config not found")
    return item


@router.delete("/{config_id}")
async def delete_agent_config(
    config_id: str,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)

    existing = await agent_config_service.get_config(config_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Agent config not found")

    # 创建者/admin 放行
    if current_user:
        if current_user.get("role") == "admin":
            pass  # admin 直接放行，跳过 scope 权限检查
        elif existing.get("created_by") and existing.get("created_by") == current_user.get("id"):
            pass  # 创建者放行
        else:
            # 其他用户执行原有 scope 权限检查
            await _check_scope_permission(
                existing.get("scope", "global"),
                existing.get("scope_target"),
                current_user,
            )
    # 如果没有 current_user（无认证模式），直接放行

    deleted = await agent_config_service.delete_config(config_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Agent config not found")
    return {"ok": True}


@router.patch("/{config_id}/toggle", response_model=AgentConfigResponse)
async def toggle_agent_config(
    config_id: str,
    body: AgentConfigToggle,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)

    existing = await agent_config_service.get_config(config_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Agent config not found")

    # 创建者/admin 放行
    if current_user:
        if current_user.get("role") == "admin":
            pass  # admin 直接放行，跳过 scope 权限检查
        elif existing.get("created_by") and existing.get("created_by") == current_user.get("id"):
            pass  # 创建者放行
        else:
            # 其他用户执行原有 scope 权限检查
            await _check_scope_permission(
                existing.get("scope", "global"),
                existing.get("scope_target"),
                current_user,
            )
    # 如果没有 current_user（无认证模式），直接放行

    item = await agent_config_service.toggle_enabled(config_id, body.enabled)
    if not item:
        raise HTTPException(status_code=404, detail="Agent config not found")
    return item
