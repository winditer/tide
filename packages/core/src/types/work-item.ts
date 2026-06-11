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
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
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
}

export interface WorkItemUpdate {
  title?: string;
  description?: string;
  priority?: number;
  assignee?: string;
  tags?: string[];
  metadata?: Record<string, any>;
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
