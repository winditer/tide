from __future__ import annotations

from datetime import datetime
from typing import List, Optional

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
    group_id: Optional[str] = None


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
    project_id: Optional[str] = None   # 新增：目标项目 ID（base64 编码的 cwd）
    cwd: Optional[str] = None           # 新增：直接指定工作目录


class PlanDefinition(BaseModel):
    tasks: list[PlanTaskDef]
    max_parallel: int = 3


class PlanCreate(BaseModel):
    definition: PlanDefinition
    workspace_id: str = "default"
    cwd: Optional[str] = None
    model: Optional[str] = None
    group_id: Optional[str] = None  # 项目组关联：提供后默认 cwd 使用组 primary 项目路径


class PlanResponse(BaseModel):
    id: str
    workspace_id: str
    status: str
    definition: Optional[str] = None
    max_parallel: int = 3
    chat_id: Optional[str] = None
    cwd: Optional[str] = None
    model: Optional[str] = None
    group_id: Optional[str] = None
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


# ── Project Group ─────────────────────

class ProjectGroupCreate(BaseModel):
    name: str
    description: Optional[str] = None
    workspace_id: str = "default"
    created_by: Optional[str] = None
    project_ids: list[str] = Field(default_factory=list)


class ProjectGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ProjectGroupMemberAdd(BaseModel):
    project_id: str
    role: str = "member"


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
    task_type: str = Field(..., pattern=r"^(agent|plan|workflow|status|custom)$")
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
    enabled: int = 1


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    definition: Optional[dict] = None
    enabled: Optional[int] = None


class WorkflowResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    description: Optional[str] = None
    definition: dict = {}
    version: int = 1
    enabled: int = 1
    created_by: Optional[str] = None
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


# ============ 工作项相关模型 ============

class WorkItemCreate(BaseModel):
    project_id: str
    title: str
    description: Optional[str] = None
    priority: int = 0
    assignee: Optional[str] = None
    tags: Optional[List[str]] = None
    source_type: str = "manual"
    source_id: Optional[str] = None
    metadata: Optional[dict] = None
    version_id: Optional[str] = None
    # 项目组 id：当工作项归属一个跨仓库项目组时填充，
    # 后端在 Agent 节点触发时会注入多仓库上下文。
    group_id: Optional[str] = None


class WorkItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    assignee: Optional[str] = None
    tags: Optional[List[str]] = None
    metadata: Optional[dict] = None
    version_id: Optional[str] = None


class WorkItemResponse(BaseModel):
    id: str
    project_id: str
    workflow_id: str
    current_node_id: str
    title: str
    description: Optional[str] = None
    priority: int = 0
    assignee: Optional[str] = None
    tags: Optional[List[str]] = None
    source_type: str = "manual"
    source_id: Optional[str] = None
    metadata: Optional[dict] = None
    status: Optional[str] = None
    version_id: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class WorkItemTransitionRequest(BaseModel):
    target_node_id: str
    operator: Optional[str] = None


class WorkItemTransitionResponse(BaseModel):
    id: str
    work_item_id: str
    from_node_id: Optional[str] = None
    to_node_id: str
    trigger_type: str = "manual"
    task_id: Optional[str] = None
    operator: Optional[str] = None
    output: Optional[str] = None
    created_at: Optional[str] = None
    plan_id: Optional[str] = None
    plan_tasks: Optional[list] = None
    task_info: Optional[dict] = None


class ProjectSettingsUpdate(BaseModel):
    workflow_id: Optional[str] = None
    default_assignee: Optional[str] = None
    metadata: Optional[dict] = None


class ProjectSettingsResponse(BaseModel):
    project_id: str
    workflow_id: Optional[str] = None
    default_assignee: Optional[str] = None
    metadata: Optional[dict] = None
    updated_at: Optional[str] = None


class WorkItemKanbanColumn(BaseModel):
    id: str
    label: str
    category: Optional[str] = None
    items: List[WorkItemResponse] = []


class WorkItemKanbanResponse(BaseModel):
    columns: List[WorkItemKanbanColumn] = []
    workflow: Optional[dict] = None


# ============ 版本相关模型 ============

class VersionCreate(BaseModel):
    project_id: str
    name: str
    description: Optional[str] = None
    status: str = "active"  # active | released | archived


class VersionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


class VersionResponse(BaseModel):
    id: str
    project_id: str
    name: str
    description: Optional[str] = None
    status: str = "active"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
