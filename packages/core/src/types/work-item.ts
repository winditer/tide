/**
 * 工作项（WorkItem）相关类型定义。
 *
 * 工作项表示项目内的一项可执行/可流转的工作单元，
 * 绑定到某个工作流（Workflow）的具体节点上推进。
 */

export type WorkItemSourceType = "manual" | "lark" | "plan" | "schedule";

export type WorkItemTriggerType =
  | "manual"
  | "auto"
  | "agent_complete"
  | "approval_pass";

/** 工作项优先级：0=无, 1=低, 2=中, 3=高, 4=紧急 */
export type WorkItemPriority = 0 | 1 | 2 | 3 | 4;

/** 工作项状态 */
export type WorkItemStatus =
  | "pending"
  | "in_progress"
  | "pending_approval"
  | "completed"
  | "failed"
  | "stopped"
  | "waiting";

export interface WorkItem {
  id: string;
  project_id: string;
  workflow_id: string;
  current_node_id: string;
  title: string;
  description?: string;
  /** 0=无, 1=低, 2=中, 3=高, 4=紧急 */
  priority: number;
  assignee?: string;
  tags?: string[];
  source_type: WorkItemSourceType;
  source_id?: string;
  metadata?: Record<string, any>;
  /** 关联版本 ID（可选） */
  version_id?: string | null;
  /** 项目组 ID（可选）：存在时表示该工作项是跨仓库任务 */
  group_id?: string | null;
  /** 推导状态：待操作、进行中、待审批、已完成、失败、已停止、等待中 */
  status?: WorkItemStatus;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

/** Plan 关联的子任务（后端 get_transitions 补充） */
export interface WorkItemPlanTask {
  id: string;
  status: string;
  prompt?: string;
  started_at?: string | null;
  completed_at?: string | null;
  branch_name?: string | null;
  commit_hash?: string | null;
}

export interface WorkItemTransition {
  id: string;
  work_item_id: string;
  from_node_id?: string;
  to_node_id: string;
  trigger_type: WorkItemTriggerType;
  task_id?: string;
  operator?: string;
  output?: string;
  created_at: string;
  /** 关联 Plan ID（后端自动补充） */
  plan_id?: string;
  /** Plan 下所有子任务（后端自动补充） */
  plan_tasks?: WorkItemPlanTask[];
  /** 单任务信息（后端自动补充） */
  task_info?: {
    id: string;
    status: string;
    prompt?: string;
  } | null;
}

export interface ProjectSettings {
  project_id: string;
  workflow_id?: string;
  default_assignee?: string;
  metadata?: Record<string, any>;
  updated_at: string;
}

export interface WorkItemCreate {
  project_id: string;
  title: string;
  description?: string;
  priority?: number;
  assignee?: string;
  tags?: string[];
  source_type?: string;
  source_id?: string;
  metadata?: Record<string, any>;
  version_id?: string | null;
  /**
   * 项目组 id：选择“项目组”作为归属时填入；
   * ``project_id`` 需同时设为该组的 primary 项目。
   */
  group_id?: string | null;
}

export interface WorkItemUpdate {
  title?: string;
  description?: string;
  priority?: number;
  assignee?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  version_id?: string | null;
}

export interface WorkItemArtifact {
  id: string;
  stage: string;
  label: string;
  url: string;
  type: string;
  created_at: string;
}

export interface WorkItemBoardColumn {
  id: string;
  label: string;
  /** stage 节点的语义分类：todo / in_progress / review / done / custom */
  category?: string;
  node_type: string;
  items: WorkItem[];
}

export interface WorkItemBoard {
  columns: WorkItemBoardColumn[];
  workflow: { id: string; name: string };
}

/** 跨仓库执行结果中单个子任务的汇总 */
export interface CrossRepoResultItem {
  project_id?: string | null;
  project_name?: string | null;
  cwd?: string | null;
  status?: string | null;
  task_id: string;
  task_index?: number | null;
  diff_summary?: string | null;
  commit_hash?: string | null;
  commit_message?: string | null;
  completed_at?: string | null;
}

/** ``GET /api/work-items/{id}/cross-repo-results`` 返回体 */
export interface CrossRepoResultsResponse {
  group_id?: string | null;
  plan_id?: string | null;
  results: CrossRepoResultItem[];
}
