"""
Approvals API — 审批流 REST 接口。

路由：
- GET  /approvals              — 列表查询（支持 workspace_id / status 筛选）
- GET  /approvals/{id}         — 详情
- POST /approvals/{id}/approve — 审批通过
- POST /approvals/{id}/reject  — 审批拒绝
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from backend.services.approval_service import approval_service

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("")
async def list_approvals(
    workspace_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """列表查询审批记录"""
    items = await approval_service.list_approvals(
        workspace_id=workspace_id,
        status=status,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": len(items)}


@router.get("/{approval_id}")
async def get_approval(approval_id: str):
    """获取单条审批详情"""
    approval = await approval_service.get_approval(approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


@router.post("/{approval_id}/approve")
async def approve(approval_id: str, operator_id: Optional[str] = None):
    """审批通过"""
    ok = await approval_service.approve(approval_id, operator_id=operator_id)
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Cannot approve: not found or already resolved",
        )
    return {"ok": True, "approval_id": approval_id, "status": "approved"}


@router.post("/{approval_id}/reject")
async def reject(approval_id: str, operator_id: Optional[str] = None):
    """审批拒绝"""
    ok = await approval_service.reject(approval_id, operator_id=operator_id)
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Cannot reject: not found or already resolved",
        )
    return {"ok": True, "approval_id": approval_id, "status": "rejected"}
