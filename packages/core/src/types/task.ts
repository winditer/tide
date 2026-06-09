export enum TaskStatusEnum {
  Queued = "queued",
  Running = "running",
  Review = "review",
  Completed = "completed",
  Failed = "failed",
  Stopped = "stopped",
  Approved = "approved",
  Rejected = "rejected",
}

export type TaskStatus = TaskStatusEnum | string;

export interface Task {
  id: string;
  workspace_id: string;
  plan_id: string | null;
  assignee_id: string | null;
  assignee_type: string;
  chat_id: string | null;
  parent_task_id: string | null;
  prompt: string;
  cwd: string | null;
  model: string | null;
  agent_id: string | null;
  session_id: string | null;
  status: TaskStatus;
  result: string | null;
  attachments: string | null;
  output_path: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  diff_summary: string | null;
  test_result: string | null;
  priority: number;
  labels: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface TaskEvent {
  type: string;
  task_id: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}
