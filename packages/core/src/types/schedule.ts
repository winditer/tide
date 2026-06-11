export type TriggerType = "cron" | "interval" | "date";
export type ScheduleTaskType = "agent" | "plan" | "status" | "custom";

export interface Schedule {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: TriggerType;
  trigger_config: Record<string, any>;
  task_type: ScheduleTaskType | string;
  task_config: Record<string, any>;
  enabled: boolean;
  workspace_id?: string;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  status: "success" | "failed" | "running";
  started_at: string;
  finished_at: string | null;
  result: Record<string, any> | null;
  error: string | null;
}

export interface CreateScheduleInput {
  name: string;
  description?: string;
  trigger_type: TriggerType;
  trigger_config: Record<string, any>;
  task_type: ScheduleTaskType;
  task_config: Record<string, any>;
  workspace_id?: string;
}

export interface UpdateScheduleInput extends Partial<CreateScheduleInput> {}
