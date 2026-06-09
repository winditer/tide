from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Task ──────────────────────────────────────────────

class TaskCreate(BaseModel):
    prompt: str
    agent_id: str = "codex"
    model: Optional[str] = None
    cwd: Optional[str] = None
    session_id: Optional[str] = None  # 续写已有会话的 ID（不填则新建会话）
    attachments: list[str] = Field(default_factory=list)
    workspace_id: str = "default"


class TaskUpdate(BaseModel):
    prompt: Optional[str] = None
    agent_id: Optional[str] = None
    model: Optional[str] = None
    cwd: Optional[str] = None
    attachments: Optional[list[str]] = None
    priority: Optional[int] = None
    labels: Optional[str] = None


class TaskResponse(BaseModel):
    id: str
    status: str
    prompt: str
    agent_id: Optional[str] = None
    model: Optional[str] = None
    cwd: Optional[str] = None
    workspace_id: str = "default"
    plan_id: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_type: str = "agent"
    chat_id: Optional[str] = None
    parent_task_id: Optional[str] = None
    session_id: Optional[str] = None
    result: Optional[str] = None
    attachments: Optional[str] = None
    output_path: Optional[str] = None
    worktree_path: Optional[str] = None
    branch_name: Optional[str] = None
    diff_summary: Optional[str] = None
    test_result: Optional[str] = None
    priority: int = 0
    labels: Optional[str] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    source: Optional[str] = None  # "db" 或 "file"，标记数据来源


class TaskListResponse(BaseModel):
    items: list[TaskResponse]
    total: int
    page: int
    page_size: int


# ── TaskEvent ─────────────────────────────────────────

class TaskEvent(BaseModel):
    id: str
    task_id: str
    event_type: str
    payload: Optional[str] = None
    created_at: Optional[datetime] = None


# ── Approval ──────────────────────────────────────────

class ApprovalAction(BaseModel):
    action: str = Field("reject", pattern=r"^(approve|reject)$")
    reason: Optional[str] = None


# ── Plan ─────────────────────────────────────────────

class PlanTaskDef(BaseModel):
    title: str
    prompt: str
    agent_id: str = "codex"
    depends_on: list[int] = []
    phase: int = 0


class PlanDefinition(BaseModel):
    tasks: list[PlanTaskDef]
    max_parallel: int = 3


class PlanCreate(BaseModel):
    definition: PlanDefinition
    workspace_id: str = "default"
    cwd: Optional[str] = None
    model: Optional[str] = None


class PlanResponse(BaseModel):
    id: str
    workspace_id: str
    status: str
    definition: Optional[str] = None
    max_parallel: int = 3
    chat_id: Optional[str] = None
    cwd: Optional[str] = None
    model: Optional[str] = None
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class PlanDAGNode(BaseModel):
    id: str
    type: str = "task"
    data: dict
    position: dict = Field(default_factory=lambda: {"x": 0, "y": 0})


class PlanDAGEdge(BaseModel):
    id: str
    source: str
    target: str


class PlanDAGResponse(BaseModel):
    nodes: list[PlanDAGNode]
    edges: list[PlanDAGEdge]


class PlanTimelineItem(BaseModel):
    task_id: str
    title: str
    phase: int = 0
    agent_id: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: str = "queued"
    duration_ms: Optional[int] = None


class PlanTaskResponse(BaseModel):
    task_id: str
    task_index: int
    phase: int = 0
    depends_on: Optional[str] = None
    title: str = ""
    status: str = "queued"
    agent_id: Optional[str] = None


# ── Schedule ─────────────────────────────────────────

class ScheduleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_type: str = Field(..., pattern=r"^(cron|interval|date)$")
    trigger_config: dict
    task_type: str = Field(..., pattern=r"^(agent|plan|status|custom)$")
    task_config: dict
    workspace_id: str = "default"


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    trigger_type: Optional[str] = None
    trigger_config: Optional[dict] = None
    task_type: Optional[str] = None
    task_config: Optional[dict] = None
    enabled: Optional[int] = None


class ScheduleResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    description: Optional[str] = None
    trigger_type: str
    trigger_config: dict = {}
    task_type: str
    task_config: dict = {}
    enabled: int = 1
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    run_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ScheduleRunResponse(BaseModel):
    id: str
    schedule_id: str
    task_id: Optional[str] = None
    status: str
    trigger_type: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[str] = None
    error: Optional[str] = None


# ── Workflow ─────────────────────────────────────────

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    definition: dict
    workspace_id: str = "default"


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    definition: Optional[dict] = None


class WorkflowResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    description: Optional[str] = None
    definition: dict = {}
    version: int = 1
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class WorkflowRunRequest(BaseModel):
    input_context: Optional[dict] = None
    trigger_type: str = "manual"


class WorkflowNodeRunResponse(BaseModel):
    id: str
    run_id: str
    node_id: str
    task_id: Optional[str] = None
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    output: Optional[str] = None
    error: Optional[str] = None


class WorkflowRunResponse(BaseModel):
    id: str
    workflow_id: str
    workspace_id: str
    status: str
    current_node_ids: list[str] = []
    context: dict = {}
    trigger_type: str = "manual"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    node_runs: list[WorkflowNodeRunResponse] = []


class ApprovalDecision(BaseModel):
    reason: Optional[str] = None


# ── Dashboard ─────────────────────────────────────────

class DashboardStats(BaseModel):
    running: int = 0
    queued: int = 0
    pending_approval: int = 0
    completed_today: int = 0


# ── Lark Bridge ───────────────────────────────────────

class LarkNotifyPayload(BaseModel):
    event_type: str  # "task_created" | "task_updated" | "task_completed"
    task_id: Optional[str] = None
    data: dict = {}


class LarkBridgeStatus(BaseModel):
    connected: bool
    last_event_at: Optional[str] = None
    pending_notifications: int = 0
