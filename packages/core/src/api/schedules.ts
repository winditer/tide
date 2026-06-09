import { apiClient } from "./client";
import type {
  Schedule,
  ScheduleRun,
  CreateScheduleInput,
  UpdateScheduleInput,
} from "../types/schedule";

export interface ListSchedulesResponse {
  items: Schedule[];
  total: number;
}

export function fetchSchedules(): Promise<ListSchedulesResponse> {
  return apiClient.get<ListSchedulesResponse>("/api/schedules");
}

export function fetchSchedule(id: string): Promise<Schedule> {
  return apiClient.get<Schedule>(`/api/schedules/${id}`);
}

export function createSchedule(params: CreateScheduleInput): Promise<Schedule> {
  return apiClient.post<Schedule>("/api/schedules", params);
}

export function updateSchedule(
  id: string,
  params: UpdateScheduleInput
): Promise<Schedule> {
  return apiClient.put<Schedule>(`/api/schedules/${id}`, params);
}

export function deleteSchedule(id: string): Promise<void> {
  return apiClient.del<void>(`/api/schedules/${id}`);
}

export function toggleSchedule(id: string): Promise<Schedule> {
  return apiClient.post<Schedule>(`/api/schedules/${id}/toggle`);
}

export function triggerSchedule(id: string): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>(`/api/schedules/${id}/trigger`);
}

export function fetchScheduleRuns(id: string): Promise<ScheduleRun[]> {
  return apiClient.get<ScheduleRun[]>(`/api/schedules/${id}/runs`);
}
