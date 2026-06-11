"""工作项 API 路由。

提供工作项 CRUD + 流转操作，对接 ``work_item_service``。
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.models.schemas import (
    WorkItemCreate,
    WorkItemResponse,
    WorkItemTransitionRequest,
    WorkItemTransitionResponse,
    WorkItemUpdate,
)
from backend.services.work_item_service import work_item_service

router = APIRouter(prefix="/api/work-items", tags=["work-items"])


@router.post("", response_model=WorkItemResponse)
async def create_work_item(body: WorkItemCreate):
    """创建工作项。"""
    try:
        result = await work_item_service.create_work_item(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create work item")
    return result


@router.get("", response_model=list[WorkItemResponse])
async def list_work_items(
    project_id: Optional[str] = Query(None, description="按项目过滤"),
    status: Optional[str] = Query(None, description="active / completed"),
):
    """列出工作项。"""
    return await work_item_service.list_work_items(project_id=project_id, status=status)


@router.get("/{item_id}", response_model=WorkItemResponse)
async def get_work_item(item_id: str):
    """工作项详情。"""
    result = await work_item_service.get_work_item(item_id)
    if not result:
        raise HTTPException(status_code=404, detail="Work item not found")
    return result


@router.patch("/{item_id}", response_model=WorkItemResponse)
async def update_work_item(item_id: str, body: WorkItemUpdate):
    """更新工作项基本信息。"""
    result = await work_item_service.update_work_item(item_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Work item not found")
    return result


@router.delete("/{item_id}")
async def delete_work_item(item_id: str):
    """删除工作项。"""
    ok = await work_item_service.delete_work_item(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Work item not found")
    return {"ok": True}


@router.post("/{item_id}/transition", response_model=WorkItemTransitionResponse)
async def transition_work_item(item_id: str, body: WorkItemTransitionRequest):
    """流转工作项到目标节点。"""
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


@router.get("/{item_id}/transitions", response_model=list[WorkItemTransitionResponse])
async def get_transitions(item_id: str):
    """获取工作项流转历史。"""
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    return await work_item_service.get_transitions(item_id)
