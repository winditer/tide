"""Schedule API — 定时任务调度 CRUD + 触发。"""

from fastapi import APIRouter, HTTPException, Query

from backend.models.schemas import ScheduleCreate, ScheduleUpdate
from backend.services.schedule_service import schedule_service

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


@router.post("")
async def create_schedule(body: ScheduleCreate):
    """创建定时任务"""
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
async def list_schedules(workspace_id: str = Query(default="default")):
    """列表查询"""
    items = await schedule_service.list_schedules(workspace_id)
    return {"items": items, "total": len(items)}


@router.get("/{schedule_id}")
async def get_schedule(schedule_id: str):
    """详情"""
    schedule = await schedule_service.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@router.put("/{schedule_id}")
async def update_schedule(schedule_id: str, body: ScheduleUpdate):
    """更新"""
    updates = body.model_dump(exclude_unset=True)
    result = await schedule_service.update_schedule(schedule_id, **updates)
    if not result:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result


@router.delete("/{schedule_id}")
async def delete_schedule(schedule_id: str):
    """删除"""
    success = await schedule_service.delete_schedule(schedule_id)
    if not success:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"ok": True}


@router.post("/{schedule_id}/toggle")
async def toggle_schedule(schedule_id: str):
    """启停切换"""
    result = await schedule_service.toggle_schedule(schedule_id)
    if not result:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result


@router.post("/{schedule_id}/trigger")
async def trigger_schedule(schedule_id: str):
    """手动触发"""
    result = await schedule_service.trigger_now(schedule_id)
    if not result:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"ok": True, "schedule_id": schedule_id}


@router.get("/{schedule_id}/runs")
async def get_schedule_runs(schedule_id: str, limit: int = Query(default=20, le=100)):
    """执行历史"""
    # Verify schedule exists
    schedule = await schedule_service.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    runs = await schedule_service.get_runs(schedule_id, limit=limit)
    return {"items": runs, "total": len(runs)}
