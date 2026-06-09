"""Workflow API 路由。

提供工作流定义 CRUD + 运行触发/审批/取消。
"""

from fastapi import APIRouter, HTTPException, Query

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


# ── Workflow definition CRUD ─────────────────────────────


@router.post("", response_model=WorkflowResponse)
async def create_workflow(body: WorkflowCreate):
    result = await workflow_service.create_workflow(
        workspace_id=body.workspace_id,
        name=body.name,
        description=body.description,
        definition_json=body.definition,
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create workflow")
    return result


@router.get("", response_model=list[WorkflowResponse])
async def list_workflows(
    workspace_id: str = Query("default"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return await workflow_service.list_workflows(
        workspace_id=workspace_id, limit=limit, offset=offset
    )


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(workflow_id: str):
    result = await workflow_service.get_workflow(workflow_id)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(workflow_id: str, body: WorkflowUpdate):
    result = await workflow_service.update_workflow(
        workflow_id=workflow_id,
        name=body.name,
        description=body.description,
        definition_json=body.definition,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str):
    ok = await workflow_service.delete_workflow(workflow_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"ok": True}


# ── Run management ───────────────────────────────────────


@router.post("/{workflow_id}/run", response_model=WorkflowRunResponse)
async def run_workflow(workflow_id: str, body: WorkflowRunRequest | None = None):
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
async def list_runs(workflow_id: str, limit: int = Query(20, ge=1, le=200)):
    wf = await workflow_service.get_workflow(workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return await workflow_service.get_runs(workflow_id, limit=limit)


@router.get("/{workflow_id}/runs/{run_id}", response_model=WorkflowRunResponse)
async def get_run(workflow_id: str, run_id: str):
    detail = await workflow_service.get_run_detail(run_id)
    if not detail or detail.get("workflow_id") != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    return detail


@router.post("/{workflow_id}/runs/{run_id}/cancel", response_model=WorkflowRunResponse)
async def cancel_run(workflow_id: str, run_id: str):
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
):
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
):
    detail = await workflow_service.get_run_detail(run_id)
    if not detail or detail.get("workflow_id") != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    body = body or ApprovalDecision()
    await workflow_engine.on_approval_resolved(
        run_id, node_id, approved=False, reason=body.reason or ""
    )
    return await workflow_service.get_run_detail(run_id)
