"""Kanban 聚合 API 路由。"""

from fastapi import APIRouter, Body, HTTPException, Query

from backend.models.schemas import (
    WorkItemKanbanResponse,
    WorkItemTransitionRequest,
    WorkItemTransitionResponse,
)
from backend.services.kanban_service import kanban_service
from backend.services.work_item_service import work_item_service

router = APIRouter(prefix="/api/kanban", tags=["kanban"])


@router.get("/projects")
async def get_project_board(workspace_id: str = "default"):
    """项目看板：按项目状态分列。"""
    return await kanban_service.get_project_board(workspace_id)


@router.get("/sessions")
async def get_session_board(workspace_id: str = "default"):
    """会话看板：按 Agent 分组，按任务状态分列。"""
    return await kanban_service.get_session_board(workspace_id)


@router.get("/agents")
async def get_agent_board(workspace_id: str = "default"):
    """Agent 看板（泳道式）。"""
    return await kanban_service.get_agent_board(workspace_id)


@router.get("/workflows")
async def get_workflow_board(workspace_id: str = "default"):
    """工作流任务看板。"""
    return await kanban_service.get_workflow_board(workspace_id)


@router.post("/move")
async def move_card(
    card_type: str = Body(...),
    card_id: str = Body(...),
    new_status: str = Body(...),
    workspace_id: str = Body("default"),
):
    """拖拽更新状态。"""
    return await kanban_service.move_card(workspace_id, card_type, card_id, new_status)


@router.get("/work-items", response_model=WorkItemKanbanResponse)
async def get_work_item_board(project_id: str = Query(..., description="项目 ID")):
    """工作项看板：按 workflow 可见节点划列。"""
    return await work_item_service.get_work_item_board(project_id)


@router.post("/work-items/{item_id}/move", response_model=WorkItemTransitionResponse)
async def move_work_item(item_id: str, body: WorkItemTransitionRequest):
    """看板拖拽流转工作项。"""
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
