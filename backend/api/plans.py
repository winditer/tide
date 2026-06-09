"""
Plan API 路由。

提供 Plan CRUD + DAG + 时间线 + 子任务管理。
"""

from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from backend.models.schemas import (
    PlanCreate,
    PlanResponse,
    PlanDAGResponse,
    PlanTimelineItem,
    PlanTaskResponse,
)
from backend.services.plan_service import plan_service

router = APIRouter(prefix="/api/plans", tags=["plans"])


class CommitRequest(BaseModel):
    commit: bool = True


@router.post("", response_model=PlanResponse)
async def create_plan(body: PlanCreate):
    """创建 Plan"""
    result = await plan_service.create_plan(
        workspace_id=body.workspace_id,
        definition_json=body.definition.model_dump(),
        cwd=body.cwd,
        model=body.model,
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create plan")
    return result


@router.get("", response_model=list[PlanResponse])
async def list_plans(
    workspace_id: str = Query("default"),
    status: Optional[str] = Query(None),
    project: Optional[str] = Query(None, description="按 cwd 精确筛选"),
    session_id: Optional[str] = Query(None, description="按关联 session 筛选（通过 plan_tasks.tasks.session_id）"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Plan 列表

    - `project`: 按 cwd 精确匹配（值通常来自 /api/projects 的 cwd 字段）
    - `session_id`: 按 plan 关联子任务的 session_id 筛选
    """
    return await plan_service.list_plans(
        workspace_id=workspace_id,
        status=status,
        project=project,
        session_id=session_id,
        limit=limit,
        offset=offset,
    )


@router.get("/{plan_id}", response_model=PlanResponse)
async def get_plan(plan_id: str):
    """Plan 详情"""
    result = await plan_service.get_plan(plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found")
    return result


@router.post("/{plan_id}/stop", response_model=PlanResponse)
async def stop_plan(plan_id: str):
    """停止 Plan"""
    result = await plan_service.stop_plan(plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found")
    return result


@router.get("/{plan_id}/tasks", response_model=list[PlanTaskResponse])
async def get_plan_tasks(plan_id: str):
    """Plan 子任务列表"""
    plan = await plan_service.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return await plan_service.get_plan_tasks(plan_id)


@router.post("/{plan_id}/tasks/{task_id}/retry")
async def retry_plan_task(plan_id: str, task_id: str):
    """重试子任务"""
    result = await plan_service.retry_task(plan_id, task_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan or task not found")
    return result


@router.post("/{plan_id}/tasks/{task_id}/approve")
async def approve_plan_task(plan_id: str, task_id: str):
    """审批子任务：使用 approved 模式重启。"""
    ok = await plan_service.approve_task(plan_id, task_id)
    if not ok:
        raise HTTPException(
            status_code=400, detail="Task is not waiting for approval"
        )
    return {"ok": True}


@router.post("/{plan_id}/tasks/{task_id}/commit")
async def commit_plan_task(plan_id: str, task_id: str, body: CommitRequest):
    """提交 / 跳过子任务的改动。"""
    result = await plan_service.commit_task(plan_id, task_id, body.commit)
    if not result.get("ok"):
        raise HTTPException(
            status_code=400, detail=result.get("error", "commit failed")
        )
    return result


@router.post("/{plan_id}/tasks/{task_id}/merge")
async def merge_plan_task(plan_id: str, task_id: str):
    """cherry-pick 合并单个已提交的子任务。"""
    result = await plan_service.merge_task(plan_id, task_id)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("message", "merge failed"))
    return result


@router.post("/{plan_id}/merge-all")
async def merge_all_plan_tasks(plan_id: str):
    """按依赖顺序合并所有 committed 子任务。"""
    plan = await plan_service.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return await plan_service.merge_all(plan_id)


@router.get("/{plan_id}/dag", response_model=PlanDAGResponse)
async def get_plan_dag(plan_id: str):
    """Plan DAG 结构（React Flow 格式）"""
    result = await plan_service.get_plan_dag(plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found or has no tasks")
    return result


@router.get("/{plan_id}/timeline", response_model=list[PlanTimelineItem])
async def get_plan_timeline(plan_id: str):
    """Plan Gantt 时间线数据"""
    plan = await plan_service.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return await plan_service.get_timeline(plan_id)
