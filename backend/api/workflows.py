"""Workflow API 路由。

提供工作流定义 CRUD + 运行触发/审批/取消。
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.core.dependencies import get_optional_user
from backend.db.engine import async_session_factory
from backend.models.schemas import (
    ApprovalDecision,
    WorkflowCreate,
    WorkflowResponse,
    WorkflowRunRequest,
    WorkflowRunResponse,
    WorkflowUpdate,
)
from backend.services.workflow_engine import workflow_engine
from backend.services.workflow_service import workflow_service

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


async def _check_workflow_write_permission(
    workflow_id: str, current_user: Optional[dict]
) -> None:
    """工作流写操作权限检查。

    规则：
    - 未登录（TIDE_REQUIRE_AUTH=0）：放行
    - viewer 角色：禁止
    - admin 角色：放行（可管理所有工作流）
    - member 角色：只能管理自己创建的工作流（created_by 匹配）
    - created_by 为 NULL 的老数据：只有 admin 能管理
    """
    if not current_user:
        return

    role = current_user.get("role", "member")

    if role == "viewer":
        raise HTTPException(status_code=403, detail="Viewer 角色无权操作工作流")

    if role == "admin":
        return

    # member 角色：检查是否是自己创建的
    from sqlalchemy import text

    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT created_by FROM workflows WHERE id = :wid"),
            {"wid": workflow_id},
        )
        row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")

    created_by = row[0]
    if created_by is None or created_by != current_user.get("id"):
        raise HTTPException(status_code=403, detail="只能管理自己创建的工作流")


# ── Workflow definition CRUD ─────────────────────────────


@router.post("", response_model=WorkflowResponse)
async def create_workflow(
    body: WorkflowCreate,
    current_user=Depends(get_optional_user),
):
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewer 角色无权创建工作流")
    created_by = current_user.get("id") if current_user else None
    result = await workflow_service.create_workflow(
        workspace_id=body.workspace_id,
        name=body.name,
        description=body.description,
        definition_json=body.definition,
        enabled=body.enabled,
        created_by=created_by,
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create workflow")
    return result


@router.get("", response_model=list[WorkflowResponse])
async def list_workflows(
    workspace_id: str = Query("default"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    enabled: Optional[int] = Query(None),
    current_user=Depends(get_optional_user),
):
    # 所有认证用户可查看全部工作流，不做项目成员过滤
    items = await workflow_service.list_workflows(
        workspace_id=workspace_id, limit=limit, offset=offset, enabled=enabled
    )
    return items


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(
    workflow_id: str,
    current_user=Depends(get_optional_user),
):
    result = await workflow_service.get_workflow(workflow_id)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(
    workflow_id: str,
    body: WorkflowUpdate,
    current_user=Depends(get_optional_user),
):
    await _check_workflow_write_permission(workflow_id, current_user)
    result = await workflow_service.update_workflow(
        workflow_id=workflow_id,
        name=body.name,
        description=body.description,
        definition_json=body.definition,
        enabled=body.enabled,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.patch("/{workflow_id}/toggle", response_model=WorkflowResponse)
async def toggle_workflow(
    workflow_id: str,
    current_user=Depends(get_optional_user),
):
    await _check_workflow_write_permission(workflow_id, current_user)
    result = await workflow_service.toggle_workflow(workflow_id)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: str,
    current_user=Depends(get_optional_user),
):
    await _check_workflow_write_permission(workflow_id, current_user)
    ok = await workflow_service.delete_workflow(workflow_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"ok": True}


# ── Run management ───────────────────────────────────────


@router.post("/{workflow_id}/run", response_model=WorkflowRunResponse)
async def run_workflow(
    workflow_id: str,
    body: WorkflowRunRequest | None = None,
    current_user=Depends(get_optional_user),
):
    await _check_workflow_write_permission(workflow_id, current_user)
    body = body or WorkflowRunRequest()
    try:
        run_id = await workflow_engine.start_run(
            workflow_id=workflow_id,
            input_context=body.input_context,
            trigger_type=body.trigger_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    detail = await workflow_service.get_run_detail(run_id)
    if not detail:
        raise HTTPException(status_code=500, detail="Run created but not found")
    return detail


@router.get("/{workflow_id}/runs", response_model=list[WorkflowRunResponse])
async def list_runs(
    workflow_id: str,
    limit: int = Query(20, ge=1, le=200),
    current_user=Depends(get_optional_user),
):
    wf = await workflow_service.get_workflow(workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return await workflow_service.get_runs(workflow_id, limit=limit)


@router.get("/{workflow_id}/runs/{run_id}", response_model=WorkflowRunResponse)
async def get_run(
    workflow_id: str,
    run_id: str,
    current_user=Depends(get_optional_user),
):
    detail = await workflow_service.get_run_detail(run_id)
    if not detail or detail.get("workflow_id") != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    return detail


@router.post("/{workflow_id}/runs/{run_id}/cancel", response_model=WorkflowRunResponse)
async def cancel_run(
    workflow_id: str,
    run_id: str,
    current_user=Depends(get_optional_user),
):
    await _check_workflow_write_permission(workflow_id, current_user)
    detail = await workflow_service.get_run_detail(run_id)
    if not detail or detail.get("workflow_id") != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    await workflow_engine.cancel_run(run_id)
    return await workflow_service.get_run_detail(run_id)


@router.post(
    "/{workflow_id}/runs/{run_id}/nodes/{node_id}/approve",
    response_model=WorkflowRunResponse,
)
async def approve_node(
    workflow_id: str,
    run_id: str,
    node_id: str,
    body: ApprovalDecision | None = None,
    current_user=Depends(get_optional_user),
):
    await _check_workflow_write_permission(workflow_id, current_user)
    detail = await workflow_service.get_run_detail(run_id)
    if not detail or detail.get("workflow_id") != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    body = body or ApprovalDecision()
    await workflow_engine.on_approval_resolved(
        run_id, node_id, approved=True, reason=body.reason or ""
    )
    return await workflow_service.get_run_detail(run_id)


@router.post(
    "/{workflow_id}/runs/{run_id}/nodes/{node_id}/reject",
    response_model=WorkflowRunResponse,
)
async def reject_node(
    workflow_id: str,
    run_id: str,
    node_id: str,
    body: ApprovalDecision | None = None,
    current_user=Depends(get_optional_user),
):
    await _check_workflow_write_permission(workflow_id, current_user)
    detail = await workflow_service.get_run_detail(run_id)
    if not detail or detail.get("workflow_id") != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    body = body or ApprovalDecision()
    await workflow_engine.on_approval_resolved(
        run_id, node_id, approved=False, reason=body.reason or ""
    )
    return await workflow_service.get_run_detail(run_id)


@router.post("/{workflow_id}/runs/{run_id}/nodes/{node_id}/resolve-merge")
async def resolve_merge_node(
    workflow_id: str,
    run_id: str,
    node_id: str,
    resolved: bool = True,
    message: str = "",
    current_user=Depends(get_optional_user),
):
    """手动解决 Git merge 冲突后的回调。

    当 git_merge 节点因冲突进入 waiting_approval 状态后，
    用户手动解决冲突并调用此接口恢复工作流执行。
    """
    await _check_workflow_write_permission(workflow_id, current_user)
    detail = await workflow_service.get_run_detail(run_id)
    if not detail or detail.get("workflow_id") != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    await workflow_engine.on_merge_resolved(run_id, node_id, resolved, message)
    return {"ok": True, "run_id": run_id, "node_id": node_id, "resolved": resolved}
