import { apiClient } from "./client";
import type {
  Plan,
  PlanDAGResponse,
  PlanTask,
  PlanDefinition,
  GanttItem,
} from "../types/plan";

export interface ListPlansParams {
  workspace_id?: string;
  status?: string;
  /** 按 plans.cwd 精确筛选 */
  project?: string;
  /** 按关联子任务的 session_id 筛选 */
  session_id?: string;
  limit?: number;
  offset?: number;
}

export interface CreatePlanParams {
  definition: PlanDefinition;
  workspace_id?: string;
  cwd?: string;
  model?: string;
}

export function getPlans(params?: ListPlansParams): Promise<Plan[]> {
  const search = new URLSearchParams();
  if (params?.workspace_id) search.set("workspace_id", params.workspace_id);
  if (params?.status) search.set("status", params.status);
  if (params?.project) search.set("project", params.project);
  if (params?.session_id) search.set("session_id", params.session_id);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  const q = search.toString();
  return apiClient.get<Plan[]>(`/api/plans${q ? `?${q}` : ""}`);
}

export function getPlan(id: string): Promise<Plan> {
  return apiClient.get<Plan>(`/api/plans/${id}`);
}

export function getPlanDAG(id: string): Promise<PlanDAGResponse> {
  return apiClient.get<PlanDAGResponse>(`/api/plans/${id}/dag`);
}

export function getPlanTasks(id: string): Promise<PlanTask[]> {
  return apiClient.get<PlanTask[]>(`/api/plans/${id}/tasks`);
}

export function getPlanTimeline(id: string): Promise<GanttItem[]> {
  return apiClient.get<GanttItem[]>(`/api/plans/${id}/timeline`);
}

export function createPlan(params: CreatePlanParams): Promise<Plan> {
  return apiClient.post<Plan>("/api/plans", params);
}

export function stopPlan(id: string): Promise<Plan> {
  return apiClient.post<Plan>(`/api/plans/${id}/stop`);
}

export function retryPlanTask(planId: string, taskId: string): Promise<unknown> {
  return apiClient.post(`/api/plans/${planId}/tasks/${taskId}/retry`);
}
