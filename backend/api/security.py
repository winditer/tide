"""Security 安全审查 API 路由。

提供安全扫描、规则管理和扫描结果管理接口，路径前缀 ``/api/security``。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.core.dependencies import get_optional_user
from backend.services.security_scanner import security_scanner

router = APIRouter(prefix="/api/security", tags=["security"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


# ── Request / Response Models ────────────────────────────


class ScanRequest(BaseModel):
    text: str
    workspace_id: str = "default"
    task_id: Optional[str] = None


class ScanFindingResponse(BaseModel):
    rule_id: str
    category: str
    severity: str
    snippet: str
    location: str
    description: str
    remediation: str


class RuleCreate(BaseModel):
    workspace_id: str = "default"
    name: str
    category: str
    pattern: str
    severity: Optional[str] = "medium"
    description: Optional[str] = None
    remediation: Optional[str] = None
    enabled: Optional[int] = 1


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    pattern: Optional[str] = None
    severity: Optional[str] = None
    description: Optional[str] = None
    remediation: Optional[str] = None
    enabled: Optional[int] = None


class RuleResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    category: str
    pattern: str
    severity: Optional[str] = "medium"
    description: Optional[str] = None
    remediation: Optional[str] = None
    enabled: int = 1
    created_at: Optional[str] = None

    class Config:
        extra = "allow"


class FindingResponse(BaseModel):
    id: str
    workspace_id: str
    task_id: Optional[str] = None
    rule_id: Optional[str] = None
    category: str
    severity: str
    snippet: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    remediation: Optional[str] = None
    status: str = "open"
    dismissed_by: Optional[str] = None
    dismissed_at: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        extra = "allow"


class DismissRequest(BaseModel):
    dismissed_by: str = "admin"


class FindingsSummaryResponse(BaseModel):
    total: int = 0
    open: int = 0
    dismissed: int = 0
    by_severity: dict = {}
    by_category: dict = {}


# ── Scan Endpoint ────────────────────────────────────────


@router.post("/scan", response_model=list[ScanFindingResponse])
async def scan_text(
    body: ScanRequest,
    current_user=Depends(get_optional_user),
):
    """手动触发安全扫描。"""
    findings = await security_scanner.scan_output(
        output=body.text,
        workspace_id=body.workspace_id,
        task_id=body.task_id,
    )
    return [
        ScanFindingResponse(
            rule_id=f.rule_id,
            category=f.category,
            severity=f.severity,
            snippet=f.snippet,
            location=f.location,
            description=f.description,
            remediation=f.remediation,
        )
        for f in findings
    ]


# ── Rules CRUD ───────────────────────────────────────────


@router.get("/rules", response_model=list[RuleResponse])
async def list_rules(
    workspace_id: str = Query("default"),
    category: Optional[str] = Query(None),
    current_user=Depends(get_optional_user),
):
    items = await security_scanner.list_rules(
        workspace_id=workspace_id,
        category=category,
    )
    return items


@router.get("/rules/{rule_id}", response_model=RuleResponse)
async def get_rule(
    rule_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    item = await security_scanner.get_rule(workspace_id, rule_id)
    if not item:
        raise HTTPException(status_code=404, detail="Security rule not found")
    return item


@router.post("/rules", response_model=RuleResponse)
async def create_rule(
    body: RuleCreate,
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    try:
        item = await security_scanner.create_rule(
            workspace_id=body.workspace_id,
            data=body.model_dump(exclude={"workspace_id"}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not item:
        raise HTTPException(status_code=500, detail="Failed to create security rule")
    return item


@router.put("/rules/{rule_id}", response_model=RuleResponse)
async def update_rule(
    rule_id: str,
    body: RuleUpdate,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    payload = body.model_dump(exclude_unset=True)
    try:
        item = await security_scanner.update_rule(
            workspace_id=workspace_id,
            rule_id=rule_id,
            data=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not item:
        raise HTTPException(status_code=404, detail="Security rule not found")
    return item


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    ok = await security_scanner.delete_rule(workspace_id, rule_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Security rule not found")
    return {"ok": True}


# ── Findings Management ──────────────────────────────────


@router.get("/findings", response_model=list[FindingResponse])
async def list_findings(
    workspace_id: str = Query("default"),
    task_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user=Depends(get_optional_user),
):
    items = await security_scanner.list_findings(
        workspace_id=workspace_id,
        task_id=task_id,
        status=status,
    )
    return items


@router.post("/findings/{finding_id}/dismiss")
async def dismiss_finding(
    finding_id: str,
    body: DismissRequest = DismissRequest(),
    current_user=Depends(get_optional_user),
):
    _ensure_not_viewer(current_user)
    dismissed_by = body.dismissed_by
    if current_user:
        dismissed_by = current_user.get("username", dismissed_by)
    ok = await security_scanner.dismiss_finding(finding_id, dismissed_by)
    if not ok:
        raise HTTPException(status_code=404, detail="Finding not found or already dismissed")
    return {"ok": True}


@router.get("/findings/summary", response_model=FindingsSummaryResponse)
async def get_findings_summary(
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    summary = await security_scanner.get_findings_summary(workspace_id)
    return summary
