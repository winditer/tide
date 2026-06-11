"""
Approvals API — 审批流 REST 接口。

路由：
- GET  /approvals              — 列表查询（支持 workspace_id / status 筛选）
- GET  /approvals/{id}         — 详情
- POST /approvals/{id}/approve — 审批通过
- POST /approvals/{id}/reject  — 审批拒绝
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional

from backend.services.approval_service import approval_service

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


class ApprovalActionBody(BaseModel):
    """审批操作请求体：可选审批意见 + 可选操作人。"""

    operator_id: Optional[str] = None
    # 审批意见。通过时可选；拒绝时建议必填（前端校验）。
    comment: Optional[str] = Field(default=None, description="审批意见 / reason / comment")
    # 兼容前端可能使用 reason 字段名
    reason: Optional[str] = None


def _extract_comment(body: Optional[ApprovalActionBody]) -> Optional[str]:
    if body is None:
        return None
    return (body.comment if body.comment is not None else body.reason)


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
async def approve(
    approval_id: str,
    body: Optional[ApprovalActionBody] = None,
    operator_id: Optional[str] = Query(None),
):
    """审批通过。可选 body: { operator_id, comment }"""
    op = (body.operator_id if body and body.operator_id else operator_id)
    comment = _extract_comment(body)
    ok = await approval_service.approve(
        approval_id, operator_id=op, comment=comment,
    )
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Cannot approve: not found or already resolved",
        )
    return {"ok": True, "approval_id": approval_id, "status": "approved"}


@router.post("/{approval_id}/reject")
async def reject(
    approval_id: str,
    body: Optional[ApprovalActionBody] = None,
    operator_id: Optional[str] = Query(None),
):
    """审批拒绝。可选 body: { operator_id, comment }（拒绝时建议必填）"""
    op = (body.operator_id if body and body.operator_id else operator_id)
    comment = _extract_comment(body)
    ok = await approval_service.reject(
        approval_id, operator_id=op, comment=comment,
    )
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Cannot reject: not found or already resolved",
        )
    return {"ok": True, "approval_id": approval_id, "status": "rejected"}
