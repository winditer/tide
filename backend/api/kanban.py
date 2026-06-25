"""Kanban 聚合 API 路由。"""

from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import text

from backend.core.dependencies import (
    check_cwd_write_permission,
    check_project_write_permission,
    encode_project_id,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.db.engine import async_session_factory
from backend.models.schemas import (
    WorkItemKanbanResponse,
    WorkItemTransitionRequest,
    WorkItemTransitionResponse,
)
from backend.services.kanban_service import kanban_service
from backend.services.work_item_service import work_item_service

router = APIRouter(prefix="/api/kanban", tags=["kanban"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


@router.get("/projects")
async def get_project_board(
    workspace_id: str = "default",
    current_user=Depends(get_optional_user),
):
    """项目看板：按项目状态分列。"""
    accessible_pids = await get_accessible_project_ids(current_user)
    board = await kanban_service.get_project_board(workspace_id)
    columns = board.get("columns") or {}
    for key, items in list(columns.items()):
        filtered = items
        if accessible_pids is not None:
            def _visible(it: dict) -> bool:
                # 项目组：只要成员项目中任一可访问即可见
                if it.get("type") == "group":
                    member_ids = it.get("member_project_ids") or []
                    return any(mid in accessible_pids for mid in member_ids)
                return (
                    (it.get("id") in accessible_pids)
                    or (encode_project_id(it.get("cwd") or "") in accessible_pids)
                )
            filtered = [it for it in filtered if _visible(it)]
        columns[key] = filtered
    return board


@router.get("/sessions")
async def get_session_board(
    workspace_id: str = "default",
    current_user=Depends(get_optional_user),
):
    """会话看板：按 Agent 分组，按任务状态分列。"""
    accessible_pids = await get_accessible_project_ids(current_user)
    board = await kanban_service.get_session_board(workspace_id)
    groups = board.get("groups") or {}
    for agent, columns in list(groups.items()):
        for col_key, items in list(columns.items()):
            if not isinstance(items, list):
                continue
            filtered = items
            if accessible_pids is not None:
                filtered = [
                    it for it in filtered
                    if not (it.get("cwd") or "")
                    or encode_project_id(it.get("cwd") or "") in accessible_pids
                ]
            columns[col_key] = filtered
    return board


@router.get("/agents")
async def get_agent_board(
    workspace_id: str = "default",
    current_user=Depends(get_optional_user),
):
    """Agent 看板（泳道式）。"""
    accessible_pids = await get_accessible_project_ids(current_user)
    board = await kanban_service.get_agent_board(workspace_id)
    swimlanes = board.get("swimlanes") or {}
    for agent, lane in list(swimlanes.items()):
        for col_key in ("running", "queued", "review", "completed", "failed"):
            items = lane.get(col_key)
            if not isinstance(items, list):
                continue
            filtered = items
            if accessible_pids is not None:
                filtered = [
                    it for it in filtered
                    if not (it.get("cwd") or "")
                    or encode_project_id(it.get("cwd") or "") in accessible_pids
                ]
            lane[col_key] = filtered
        # Recalculate idle state after filtering
        lane["idle"] = not (
            lane.get("running") or lane.get("queued") or lane.get("review")
        )
    return board


@router.get("/workflows")
async def get_workflow_board(
    workspace_id: str = "default",
    current_user=Depends(get_optional_user),
):
    """工作流任务看板。"""
    return await kanban_service.get_workflow_board(workspace_id)


@router.post("/move")
async def move_card(
    card_type: str = Body(...),
    card_id: str = Body(...),
    new_status: str = Body(...),
    workspace_id: str = Body("default"),
    current_user=Depends(get_optional_user),
):
    """拖拽更新状态。"""
    _ensure_not_viewer(current_user)
    # 根据 card_type/card_id 反查项目归属，进行项目级 viewer 权限检查
    cwd: Optional[str] = None
    if card_type in ("task", "plan"):
        table = "tasks" if card_type == "task" else "plans"
        async with async_session_factory() as session:
            r = await session.execute(
                text(f"SELECT cwd FROM {table} WHERE id = :id LIMIT 1"),
                {"id": card_id},
            )
            row = r.fetchone()
            if row:
                cwd = row[0]
    if cwd:
        await check_cwd_write_permission(cwd, current_user)
    return await kanban_service.move_card(workspace_id, card_type, card_id, new_status)


@router.get("/work-items", response_model=WorkItemKanbanResponse)
async def get_work_item_board(
    project_id: str = Query(..., description="项目 ID"),
    version_id: Optional[str] = Query(None, description="版本筛选"),
    current_user=Depends(get_optional_user),
):
    """工作项看板：按 workflow 可见节点划列。"""
    return await work_item_service.get_work_item_board(
        project_id, version_id=version_id
    )


@router.post("/work-items/{item_id}/move", response_model=WorkItemTransitionResponse)
async def move_work_item(
    item_id: str,
    body: WorkItemTransitionRequest,
    current_user=Depends(get_optional_user),
):
    """看板拖拽流转工作项。"""
    _ensure_not_viewer(current_user)
    item = await work_item_service.get_work_item(item_id)
    if item:
        await check_project_write_permission(item.get("project_id"), current_user)
    if not body.target_node_id:
        raise HTTPException(status_code=400, detail="target_node_id is required")
    try:
        transition = await work_item_service.transition_work_item(
            item_id=item_id,
            target_node_id=body.target_node_id,
            operator=body.operator or "system",
            trigger_type="manual",
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)
    return transition
