"""
Plan API 路由。

提供 Plan CRUD + DAG + 时间线 + 子任务管理。
"""

from typing import Optional

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from backend.core.dependencies import (
    check_cwd_write_permission,
    encode_project_id,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.db.engine import async_session_factory
from backend.models.schemas import (
    PlanCreate,
    PlanResponse,
    PlanDAGResponse,
    PlanTimelineItem,
    PlanTaskResponse,
)
from backend.services.plan_service import plan_service

router = APIRouter(prefix="/api/plans", tags=["plans"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


async def _ensure_project_membership(cwd: Optional[str], current_user: Optional[dict]) -> None:
    """确保创建者是 cwd 对应项目的成员，避免列表过滤把自己刚创建的 Plan 过滤掉。"""
    if not current_user or not cwd:
        return
    if current_user.get("role") == "admin":
        return
    project_id = encode_project_id(cwd)
    if not project_id:
        return
    async with async_session_factory() as session:
        await session.execute(
            text(
                """
                INSERT OR IGNORE INTO project_members
                    (id, project_id, user_id, role, created_at)
                VALUES (:id, :project_id, :user_id, :role, :created_at)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "project_id": project_id,
                "user_id": current_user["id"],
                "role": "member",
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await session.commit()


class CommitRequest(BaseModel):
    commit: bool = True


@router.post("", response_model=PlanResponse)
async def create_plan(
    body: PlanCreate,
    current_user=Depends(get_optional_user),
):
    """创建 Plan"""
    _ensure_not_viewer(current_user)
    # 项目组模式下未显式传 cwd 时，查出 primary 项目路径作为写入权限检查与 member 同步的默认 cwd
    effective_cwd: Optional[str] = body.cwd
    if body.group_id and not effective_cwd:
        try:
            from backend.services.project_group_service import (
                project_group_service,
            )

            group_projects = await project_group_service.get_group_projects(
                body.group_id
            )
            if group_projects:
                primary = next(
                    (p for p in group_projects if p.get("role") == "primary"),
                    group_projects[0],
                )
                primary_cwd = (primary or {}).get("cwd")
                if primary_cwd:
                    effective_cwd = primary_cwd
        except Exception:  # noqa: BLE001
            effective_cwd = body.cwd
    await check_cwd_write_permission(effective_cwd, current_user)
    # 确保 member 在 project_members 中存在对应项目的成员记录，避免列表过滤把自己刚创建的 Plan 过滤掉
    await _ensure_project_membership(effective_cwd, current_user)
    result = await plan_service.create_plan(
        workspace_id=body.workspace_id,
        definition_json=body.definition.model_dump(),
        cwd=body.cwd,
        model=body.model,
        group_id=body.group_id,
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
    group_id: Optional[str] = Query(None, description="按 plans.group_id 精确筛选项目组"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_optional_user),
):
    """Plan 列表

    - `project`: 按 cwd 精确匹配（值通常来自 /api/projects 的 cwd 字段）
    - `session_id`: 按 plan 关联子任务的 session_id 筛选
    - `group_id`: 按 plan.group_id 精确匹配（项目组工作区）
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    items = await plan_service.list_plans(
        workspace_id=workspace_id,
        status=status,
        project=project,
        session_id=session_id,
        group_id=group_id,
        limit=limit,
        offset=offset,
    )
    if accessible_pids is not None:
        items = [
            it for it in items
            if not ((it.get("cwd") if isinstance(it, dict) else getattr(it, "cwd", "")) or "")
            or encode_project_id(
                (it.get("cwd") if isinstance(it, dict) else getattr(it, "cwd", ""))
                or ""
            ) in accessible_pids
        ]
    return items


@router.get("/{plan_id}", response_model=PlanResponse)
async def get_plan(
    plan_id: str,
    current_user=Depends(get_optional_user),
):
    """Plan 详情"""
    result = await plan_service.get_plan(plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found")
    return result


@router.post("/{plan_id}/stop", response_model=PlanResponse)
async def stop_plan(
    plan_id: str,
    current_user=Depends(get_optional_user),
):
    """停止 Plan"""
    _ensure_not_viewer(current_user)
    plan = await plan_service.get_plan(plan_id)
    if plan:
        await check_cwd_write_permission(plan.get("cwd") if isinstance(plan, dict) else getattr(plan, "cwd", None), current_user)
    result = await plan_service.stop_plan(plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found")
    return result


@router.get("/{plan_id}/tasks", response_model=list[PlanTaskResponse])
async def get_plan_tasks(
    plan_id: str,
    current_user=Depends(get_optional_user),
):
    """Plan 子任务列表"""
    plan = await plan_service.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return await plan_service.get_plan_tasks(plan_id)


@router.post("/{plan_id}/tasks/{task_id}/retry")
async def retry_plan_task(
    plan_id: str,
    task_id: str,
    current_user=Depends(get_optional_user),
):
    """重试子任务"""
    _ensure_not_viewer(current_user)
    plan = await plan_service.get_plan(plan_id)
    if plan:
        await check_cwd_write_permission(plan.get("cwd") if isinstance(plan, dict) else getattr(plan, "cwd", None), current_user)
    result = await plan_service.retry_task(plan_id, task_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan or task not found")
    return result


@router.post("/{plan_id}/tasks/{task_id}/approve")
async def approve_plan_task(
    plan_id: str,
    task_id: str,
    current_user=Depends(get_optional_user),
):
    """审批子任务：使用 approved 模式重启。"""
    _ensure_not_viewer(current_user)
    plan = await plan_service.get_plan(plan_id)
    if plan:
        await check_cwd_write_permission(plan.get("cwd") if isinstance(plan, dict) else getattr(plan, "cwd", None), current_user)
    ok = await plan_service.approve_task(plan_id, task_id)
    if not ok:
        raise HTTPException(
            status_code=400, detail="Task is not waiting for approval"
        )
    return {"ok": True}


@router.post("/{plan_id}/tasks/{task_id}/commit")
async def commit_plan_task(
    plan_id: str,
    task_id: str,
    body: CommitRequest,
    current_user=Depends(get_optional_user),
):
    """提交 / 跳过子任务的改动。"""
    _ensure_not_viewer(current_user)
    plan = await plan_service.get_plan(plan_id)
    if plan:
        await check_cwd_write_permission(plan.get("cwd") if isinstance(plan, dict) else getattr(plan, "cwd", None), current_user)
    result = await plan_service.commit_task(plan_id, task_id, body.commit)
    if not result.get("ok"):
        raise HTTPException(
            status_code=400, detail=result.get("error", "commit failed")
        )
    return result


@router.post("/{plan_id}/tasks/{task_id}/merge")
async def merge_plan_task(
    plan_id: str,
    task_id: str,
    current_user=Depends(get_optional_user),
):
    """cherry-pick 合并单个已提交的子任务。"""
    _ensure_not_viewer(current_user)
    plan = await plan_service.get_plan(plan_id)
    if plan:
        await check_cwd_write_permission(plan.get("cwd") if isinstance(plan, dict) else getattr(plan, "cwd", None), current_user)
    result = await plan_service.merge_task(plan_id, task_id)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("message", "merge failed"))
    return result


@router.post("/{plan_id}/merge-all")
async def merge_all_plan_tasks(
    plan_id: str,
    current_user=Depends(get_optional_user),
):
    """按依赖顺序合并所有 committed 子任务。"""
    _ensure_not_viewer(current_user)
    plan = await plan_service.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    await check_cwd_write_permission(plan.get("cwd") if isinstance(plan, dict) else getattr(plan, "cwd", None), current_user)
    return await plan_service.merge_all(plan_id)


@router.get("/{plan_id}/dag", response_model=PlanDAGResponse)
async def get_plan_dag(
    plan_id: str,
    current_user=Depends(get_optional_user),
):
    """Plan DAG 结构（React Flow 格式）"""
    result = await plan_service.get_plan_dag(plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found or has no tasks")
    return result


@router.get("/{plan_id}/timeline", response_model=list[PlanTimelineItem])
async def get_plan_timeline(
    plan_id: str,
    current_user=Depends(get_optional_user),
):
    """Plan Gantt 时间线数据"""
    plan = await plan_service.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return await plan_service.get_timeline(plan_id)
