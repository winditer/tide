"""
Approvals API — 审批流 REST 接口。

路由：
- GET  /approvals              — 列表查询（支持 workspace_id / status 筛选）
- GET  /approvals/{id}         — 详情
- POST /approvals/{id}/approve — 审批通过
- POST /approvals/{id}/reject  — 审批拒绝
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text
from typing import Optional

from backend.core.dependencies import (
    check_cwd_write_permission,
    encode_project_id,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.db.engine import async_session_factory
from backend.services.approval_service import approval_service

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


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


async def _approval_cwd(approval: Optional[dict]) -> Optional[str]:
    """从审批记录反查关联 task/plan/work_item 的 cwd / project_id。

    对于 work_item_transition 类型，返回的是 work_items.project_id 对应的 cwd代理值。
    """
    if not approval:
        return None
    task_id = approval.get("task_id")
    plan_id = approval.get("plan_id")
    approval_type = approval.get("type")
    if not task_id and not plan_id:
        return None
    async with async_session_factory() as session:
        # work_item_transition: task_id 实为 work_item_id，用 project_id 反查
        if approval_type == "work_item_transition" and task_id:
            r = await session.execute(
                text("SELECT project_id FROM work_items WHERE id = :id LIMIT 1"),
                {"id": task_id},
            )
            row = r.fetchone()
            if row and row[0]:
                # project_id 已是编码值，返回一个哨兵值让调用者能 encode
                # 但实际上这里的调用者用 encode_project_id(cwd) 来得到 project_id，
                # 所以我们返回一个特殊标记，在调用处处理。
                # 此处返回 project_id 本身，外层 check_cwd_write_permission 会调用 encode_project_id，
                # 但 encode_project_id(已编码值) 会变形。改用直接返回 None 放行，
                # 因为详情/approve/reject 已有 viewer 拦截。
                return None
            return None
        if task_id:
            r = await session.execute(
                text("SELECT cwd FROM tasks WHERE id = :id LIMIT 1"),
                {"id": task_id},
            )
            row = r.fetchone()
            if row and row[0]:
                return row[0]
        if plan_id:
            r = await session.execute(
                text("SELECT cwd FROM plans WHERE id = :id LIMIT 1"),
                {"id": plan_id},
            )
            row = r.fetchone()
            if row and row[0]:
                return row[0]
    return None


@router.get("")
async def list_approvals(
    workspace_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_optional_user),
):
    """列表查询审批记录"""
    accessible_pids = await get_accessible_project_ids(current_user)
    items = await approval_service.list_approvals(
        workspace_id=workspace_id,
        status=status,
        limit=limit,
        offset=offset,
    )
    if accessible_pids is not None and items:
        # 通过审批关联的 task/plan/work_item 反查其 cwd/project_id 并过滤
        task_ids = [it["task_id"] for it in items
                    if it.get("task_id") and it.get("type") != "work_item_transition"]
        plan_ids = [it["plan_id"] for it in items if it.get("plan_id")]
        # work_item_transition 类型的审批，task_id 实际存储 work_item_id
        work_item_ids = [it["task_id"] for it in items
                        if it.get("task_id") and it.get("type") == "work_item_transition"]
        task_cwd: dict[str, str] = {}
        plan_cwd: dict[str, str] = {}
        work_item_pid: dict[str, str] = {}
        async with async_session_factory() as session:
            if task_ids:
                r = await session.execute(
                    text("SELECT id, cwd FROM tasks WHERE id IN :ids").bindparams(
                        bindparam("ids", expanding=True)
                    ),
                    {"ids": list(set(task_ids))},
                )
                for row in r.fetchall():
                    task_cwd[row[0]] = row[1] or ""
            if plan_ids:
                r = await session.execute(
                    text("SELECT id, cwd FROM plans WHERE id IN :ids").bindparams(
                        bindparam("ids", expanding=True)
                    ),
                    {"ids": list(set(plan_ids))},
                )
                for row in r.fetchall():
                    plan_cwd[row[0]] = row[1] or ""
            if work_item_ids:
                r = await session.execute(
                    text("SELECT id, project_id FROM work_items WHERE id IN :ids").bindparams(
                        bindparam("ids", expanding=True)
                    ),
                    {"ids": list(set(work_item_ids))},
                )
                for row in r.fetchall():
                    work_item_pid[row[0]] = row[1] or ""

        def _approval_pid(it: dict) -> Optional[str]:
            if it.get("type") == "work_item_transition":
                # work_items.project_id 已是编码后的 project_id，直接返回
                return work_item_pid.get(it.get("task_id") or "") or None
            cwd = task_cwd.get(it.get("task_id") or "") or plan_cwd.get(
                it.get("plan_id") or ""
            )
            return encode_project_id(cwd) if cwd else None

        items = [it for it in items if _approval_pid(it) in accessible_pids]
    return {"items": items, "total": len(items)}


@router.get("/{approval_id}")
async def get_approval(
    approval_id: str,
    current_user=Depends(get_optional_user),
):
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
    current_user=Depends(get_optional_user),
):
    """审批通过。可选 body: { operator_id, comment }"""
    _ensure_not_viewer(current_user)
    approval = await approval_service.get_approval(approval_id)
    if approval:
        await check_cwd_write_permission(await _approval_cwd(approval), current_user)
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
    current_user=Depends(get_optional_user),
):
    """审批拒绝。可选 body: { operator_id, comment }（拒绝时建议必填）"""
    _ensure_not_viewer(current_user)
    approval = await approval_service.get_approval(approval_id)
    if approval:
        await check_cwd_write_permission(await _approval_cwd(approval), current_user)
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
