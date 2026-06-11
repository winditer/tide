"""工作项 API 路由。

提供工作项 CRUD + 流转操作，对接 ``work_item_service``。
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.core.dependencies import get_accessible_project_ids, get_optional_user
from backend.models.schemas import (
    WorkItemCreate,
    WorkItemResponse,
    WorkItemTransitionRequest,
    WorkItemTransitionResponse,
    WorkItemUpdate,
)
from backend.services.work_item_service import work_item_service

router = APIRouter(prefix="/api/work-items", tags=["work-items"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


@router.post("", response_model=WorkItemResponse)
async def create_work_item(
    body: WorkItemCreate,
    current_user=Depends(get_optional_user),
):
    """创建工作项。"""
    _ensure_not_viewer(current_user)
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
    current_user=Depends(get_optional_user),
):
    """列出工作项。"""
    accessible_pids = await get_accessible_project_ids(current_user)
    if accessible_pids is not None:
        if project_id is not None:
            if project_id not in accessible_pids:
                return []
            return await work_item_service.list_work_items(
                project_id=project_id, status=status
            )
        items = await work_item_service.list_work_items(
            project_id=None, status=status
        )
        return [it for it in items if (
            (it.get("project_id") if isinstance(it, dict) else getattr(it, "project_id", None))
            in accessible_pids
        )]
    return await work_item_service.list_work_items(project_id=project_id, status=status)


@router.get("/{item_id}", response_model=WorkItemResponse)
async def get_work_item(
    item_id: str,
    current_user=Depends(get_optional_user),
):
    """工作项详情。"""
    result = await work_item_service.get_work_item(item_id)
    if not result:
        raise HTTPException(status_code=404, detail="Work item not found")
    return result


@router.patch("/{item_id}", response_model=WorkItemResponse)
async def update_work_item(
    item_id: str,
    body: WorkItemUpdate,
    current_user=Depends(get_optional_user),
):
    """更新工作项基本信息。"""
    _ensure_not_viewer(current_user)
    result = await work_item_service.update_work_item(item_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Work item not found")
    return result


@router.delete("/{item_id}")
async def delete_work_item(
    item_id: str,
    current_user=Depends(get_optional_user),
):
    """删除工作项。"""
    _ensure_not_viewer(current_user)
    ok = await work_item_service.delete_work_item(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Work item not found")
    return {"ok": True}


@router.post("/{item_id}/transition", response_model=WorkItemTransitionResponse)
async def transition_work_item(
    item_id: str,
    body: WorkItemTransitionRequest,
    current_user=Depends(get_optional_user),
):
    """流转工作项到目标节点。"""
    _ensure_not_viewer(current_user)
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
async def get_transitions(
    item_id: str,
    current_user=Depends(get_optional_user),
):
    """获取工作项流转历史。"""
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    return await work_item_service.get_transitions(item_id)
