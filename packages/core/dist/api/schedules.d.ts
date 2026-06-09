import type { Schedule, ScheduleRun, CreateScheduleInput, UpdateScheduleInput } from "../types/schedule";
export interface ListSchedulesResponse {
    items: Schedule[];
    total: number;
}
export declare function fetchSchedules(): Promise<ListSchedulesResponse>;
export declare function fetchSchedule(id: string): Promise<Schedule>;
export declare function createSchedule(params: CreateScheduleInput): Promise<Schedule>;
export declare function updateSchedule(id: string, params: UpdateScheduleInput): Promise<Schedule>;
export declare function deleteSchedule(id: string): Promise<void>;
export declare function toggleSchedule(id: string): Promise<Schedule>;
export declare function triggerSchedule(id: string): Promise<{
    message: string;
}>;
export declare function fetchScheduleRuns(id: string): Promise<ScheduleRun[]>;
//# sourceMappingURL=schedules.d.ts.map