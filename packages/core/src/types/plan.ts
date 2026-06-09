export type PlanTaskStatus =
  | "queued"
  | "running"
  | "review"
  | "approved"
  | "completed"
  | "failed"
  | "stopped"
  | "cancelled"
  | "rejected";

export interface PlanTaskDef {
  title: string;
  prompt: string;
  agent_id?: string;
  depends_on?: number[];
  phase?: number;
}

export interface PlanDefinition {
  tasks: PlanTaskDef[];
  max_parallel?: number;
}

export interface Plan {
  id: string;
  workspace_id: string;
  status: "active" | "completed" | "stopped" | string;
  definition?: string | null;
  max_parallel: number;
  chat_id?: string | null;
  cwd?: string | null;
  model?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
}

export interface PlanDAGNodeData {
  title: string;
  status: PlanTaskStatus | string;
  agentId?: string;
  agent_id?: string;
  phase?: number;
  taskIndex?: number;
  task_index?: number;
  taskId?: string;
  task_id?: string;
}

export interface PlanDAGNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: PlanDAGNodeData;
}

export interface PlanDAGEdge {
  id: string;
  source: string;
  target: string;
}

export interface PlanDAGResponse {
  nodes: PlanDAGNode[];
  edges: PlanDAGEdge[];
}

export interface PlanTask {
  task_id: string;
  task_index: number;
  phase: number;
  depends_on?: string | null;
  title: string;
  status: PlanTaskStatus | string;
  agent_id?: string | null;
}

export interface GanttItem {
  task_id: string;
  title: string;
  phase: number;
  agent_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  status: PlanTaskStatus | string;
  duration_ms?: number | null;
}
