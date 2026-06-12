export interface Schedule {
    id: string;
    name: string;
    cron_expr: string;
    task_type: string;
    task_config: Record<string, any>;
    enabled: boolean;
    next_run_at: string | null;
    last_run_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface ScheduleRun {
    id: string;
    schedule_id: string;
    task_id: string | null;
    task_title: string | null;
    task_type: string | null;
    status: "success" | "failed" | "running";
    started_at: string;
    finished_at: string | null;
    completed_at: string | null;
    result: Record<string, any> | null;
    error: string | null;
}
export interface CreateScheduleInput {
    name: string;
    cron_expr: string;
    task_type: string;
    task_config: Record<string, any>;
}
export interface UpdateScheduleInput extends Partial<CreateScheduleInput> {
}
//# sourceMappingURL=schedule.d.ts.map