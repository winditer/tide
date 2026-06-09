"""Kanban 聚合 API 路由。"""

from fastapi import APIRouter, Body

from backend.services.kanban_service import kanban_service

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
