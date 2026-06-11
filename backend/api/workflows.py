"""Workflow API 路由。

提供工作流定义 CRUD + 运行触发/审批/取消。
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import bindparam, text

from backend.core.dependencies import (
    check_project_write_permission,
    get_accessible_project_ids,
    get_optional_user,
)
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


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


async def _check_workflow_project_write(
    workflow_id: str, current_user: Optional[dict]
) -> None:
    """对绑定了当前用户可见项目的 workflow，逐个检查项目级 viewer 限制。

    如果该 workflow 未绑定任何项目，或未绑定到当前用户所属项目，则仅依赖全局检查。
    """
    if not current_user or current_user.get("role") == "admin":
        return
    async with async_session_factory() as session:
        r = await session.execute(
            text(
                "SELECT DISTINCT project_id FROM project_settings"
                " WHERE workflow_id = :wid AND project_id IS NOT NULL"
            ),
            {"wid": workflow_id},
        )
        project_ids = [row[0] for row in r.fetchall() if row[0]]
    for pid in project_ids:
        await check_project_write_permission(pid, current_user)


# ── Workflow definition CRUD ─────────────────────────────


@router.post("", response_model=WorkflowResponse)
async def create_workflow(
    body: WorkflowCreate,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    result = await workflow_service.create_workflow(
        workspace_id=body.workspace_id,
        name=body.name,
        description=body.description,
        definition_json=body.definition,
        enabled=body.enabled,
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
    accessible_pids = await get_accessible_project_ids(current_user)
    items = await workflow_service.list_workflows(
        workspace_id=workspace_id, limit=limit, offset=offset, enabled=enabled
    )
    if accessible_pids is not None:
        # 查询当前用户可访问项目绑定的 workflow_id 集合
        if not accessible_pids:
            return []
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    "SELECT DISTINCT workflow_id FROM project_settings"
                    " WHERE project_id IN :pids AND workflow_id IS NOT NULL"
                ).bindparams(bindparam("pids", expanding=True)),
                {"pids": list(accessible_pids)},
            )
            allowed_wf_ids = {row[0] for row in r.fetchall() if row[0]}
        items = [
            it for it in items
            if (it.get("id") if isinstance(it, dict) else getattr(it, "id", None))
            in allowed_wf_ids
        ]
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
    _ensure_not_viewer(current_user)
    await _check_workflow_project_write(workflow_id, current_user)
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
    _ensure_not_viewer(current_user)
    await _check_workflow_project_write(workflow_id, current_user)
    result = await workflow_service.toggle_workflow(workflow_id)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: str,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    await _check_workflow_project_write(workflow_id, current_user)
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
    _ensure_not_viewer(current_user)
    await _check_workflow_project_write(workflow_id, current_user)
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
    _ensure_not_viewer(current_user)
    await _check_workflow_project_write(workflow_id, current_user)
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
    _ensure_not_viewer(current_user)
    await _check_workflow_project_write(workflow_id, current_user)
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
    _ensure_not_viewer(current_user)
    await _check_workflow_project_write(workflow_id, current_user)
    detail = await workflow_service.get_run_detail(run_id)
    if not detail or detail.get("workflow_id") != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    body = body or ApprovalDecision()
    await workflow_engine.on_approval_resolved(
        run_id, node_id, approved=False, reason=body.reason or ""
    )
    return await workflow_service.get_run_detail(run_id)
