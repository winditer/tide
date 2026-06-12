"""Schedule API — 定时任务调度 CRUD + 触发。"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from backend.core.dependencies import (
    check_cwd_write_permission,
    encode_project_id,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.db.engine import async_session_factory
from backend.models.schemas import ScheduleCreate, ScheduleUpdate
from backend.services.schedule_service import schedule_service

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


async def _ensure_project_membership(cwd: Optional[str], current_user: Optional[dict]) -> None:
    """确保 current_user 是 cwd 对应项目的成员。

    member 在创建带 cwd 的资源（schedule 等）时，如果其在 project_members 中没有该项目的记录，
    会因后续过滤逻辑而看不到自己刚创建的记录。这里以 INSERT OR IGNORE 方式补齐成员关系，
    避免“创建后看不到”问题；admin 与匿名用户跳过。
    """
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


def _schedule_cwd(schedule: Optional[dict]) -> Optional[str]:
    """从 schedule 记录的 task_config 中提取 cwd。"""
    if not schedule:
        return None
    cfg = schedule.get("task_config") or {}
    if isinstance(cfg, dict):
        cwd = cfg.get("cwd")
        return cwd if isinstance(cwd, str) and cwd else None
    return None


@router.post("")
async def create_schedule(
    body: ScheduleCreate,
    current_user=Depends(get_optional_user),
):
    """创建定时任务"""
    _ensure_not_viewer(current_user)
    cfg_cwd = (body.task_config or {}).get("cwd") if isinstance(body.task_config, dict) else None
    await check_cwd_write_permission(cfg_cwd, current_user)
    # 确保 member 在 project_members 中存在对应项目的成员记录，避免列表过滤把自己创建的调度过滤掉
    await _ensure_project_membership(cfg_cwd, current_user)
    result = await schedule_service.create_schedule(
        workspace_id=body.workspace_id,
        name=body.name,
        description=body.description or "",
        trigger_type=body.trigger_type,
        trigger_config=body.trigger_config,
        task_type=body.task_type,
        task_config=body.task_config,
    )
    return result


@router.get("")
async def list_schedules(
    workspace_id: str = Query(default="default"),
    current_user=Depends(get_optional_user),
):
    """列表查询"""
    accessible_pids = await get_accessible_project_ids(current_user)
    items = await schedule_service.list_schedules(workspace_id)
    if accessible_pids is not None:
        filtered = []
        for it in items:
            cfg = it.get("task_config") or {}
            cwd = cfg.get("cwd") if isinstance(cfg, dict) else ""
            # 无 cwd 的调度不绑定项目，对所有认证用户可见；
            # 有 cwd 的调度需匹配用户可访问项目
            if not cwd or encode_project_id(cwd) in accessible_pids:
                filtered.append(it)
        items = filtered
    return {"items": items, "total": len(items)}


@router.get("/{schedule_id}")
async def get_schedule(
    schedule_id: str,
    current_user=Depends(get_optional_user),
):
    """详情"""
    schedule = await schedule_service.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@router.put("/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    body: ScheduleUpdate,
    current_user=Depends(get_optional_user),
):
    """更新"""
    _ensure_not_viewer(current_user)
    existing = await schedule_service.get_schedule(schedule_id)
    await check_cwd_write_permission(_schedule_cwd(existing), current_user)
    updates = body.model_dump(exclude_unset=True)
    new_cfg = updates.get("task_config")
    if isinstance(new_cfg, dict) and new_cfg.get("cwd"):
        await check_cwd_write_permission(new_cfg.get("cwd"), current_user)
    result = await schedule_service.update_schedule(schedule_id, **updates)
    if not result:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result


@router.delete("/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    current_user=Depends(get_optional_user),
):
    """删除"""
    _ensure_not_viewer(current_user)
    existing = await schedule_service.get_schedule(schedule_id)
    await check_cwd_write_permission(_schedule_cwd(existing), current_user)
    success = await schedule_service.delete_schedule(schedule_id)
    if not success:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"ok": True}


@router.post("/{schedule_id}/toggle")
async def toggle_schedule(
    schedule_id: str,
    current_user=Depends(get_optional_user),
):
    """启停切换"""
    _ensure_not_viewer(current_user)
    existing = await schedule_service.get_schedule(schedule_id)
    await check_cwd_write_permission(_schedule_cwd(existing), current_user)
    result = await schedule_service.toggle_schedule(schedule_id)
    if not result:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result


@router.post("/{schedule_id}/trigger")
async def trigger_schedule(
    schedule_id: str,
    current_user=Depends(get_optional_user),
):
    """手动触发"""
    _ensure_not_viewer(current_user)
    existing = await schedule_service.get_schedule(schedule_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await check_cwd_write_permission(_schedule_cwd(existing), current_user)
    result = await schedule_service.trigger_now(schedule_id)
    if not result:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"ok": True, "schedule_id": schedule_id, "message": "Triggered successfully"}


@router.get("/{schedule_id}/runs")
async def get_schedule_runs(
    schedule_id: str,
    limit: int = Query(default=20, le=100),
    current_user=Depends(get_optional_user),
):
    """执行历史"""
    # Verify schedule exists
    schedule = await schedule_service.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    runs = await schedule_service.get_runs(schedule_id, limit=limit)
    return {"items": runs, "total": len(runs)}
