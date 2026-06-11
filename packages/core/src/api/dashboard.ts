import { apiClient } from "./client";

export interface DashboardStats {
  running: number;
  queued: number;
  pending_approval: number;
  completed_today: number;
}

export interface RecentTask {
  id: string;
  prompt: string;
  agent_id: string | null;
  model: string | null;
  status: string;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface RecentTasksResponse {
  tasks: RecentTask[];
}

export interface AgentInfo {
  id: string;
  name: string;
  available: boolean;
  running_tasks: number;
  queued_tasks: number;
}

export interface AgentsResponse {
  agents: AgentInfo[];
}

export interface ProjectInfo {
  id: string;
  name: string;
  cwd: string;
  task_count: number;
  running_tasks: number;
  last_active: string | null;
  status: "active" | "idle";
  session_count?: number;
  /**
   * 项目维度的 Chats 数量。列表接口 ``GET /api/projects`` 为避免性能问题不计算，
   * 返回 ``null``；仅项目详情接口 ``GET /api/projects/{id}`` 返回精确数字。
   */
  chat_count?: number | null;
  archived?: boolean;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
}

export interface SessionInfo {
  session_id: string;
  agent_id: string | null;
  cwd: string | null;
  task_count: number;
  last_status: string;
  last_active: string | null;
  archived?: boolean;
}

export interface SessionsResponse {
  sessions: SessionInfo[];
  total?: number;
  page?: number;
  page_size?: number;
}

export function getDashboardStats(): Promise<DashboardStats> {
  return apiClient.get<DashboardStats>("/api/dashboard/stats");
}

export function getRecentTasks(limit = 10): Promise<RecentTasksResponse> {
  return apiClient.get<RecentTasksResponse>(`/api/dashboard/recent-tasks?limit=${limit}`);
}

export function getAgents(): Promise<AgentsResponse> {
  return apiClient.get<AgentsResponse>("/api/agents");
}

export function getProjects(params?: { show_archived?: boolean }): Promise<ProjectsResponse> {
  const search = new URLSearchParams();
  if (params?.show_archived !== undefined)
    search.set("show_archived", params.show_archived ? "true" : "false");
  const q = search.toString();
  return apiClient.get<ProjectsResponse>(`/api/projects${q ? `?${q}` : ""}`);
}

export interface GetSessionsParams {
  project?: string;
  agent_id?: string;
  page?: number;
  page_size?: number;
  show_archived?: boolean;
}

export function getSessions(params?: GetSessionsParams): Promise<SessionsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.project) searchParams.set("project", params.project);
  if (params?.agent_id) searchParams.set("agent_id", params.agent_id);
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.page_size) searchParams.set("page_size", String(params.page_size));
  if (params?.show_archived !== undefined)
    searchParams.set("show_archived", params.show_archived ? "true" : "false");
  const query = searchParams.toString();
  return apiClient.get<SessionsResponse>(`/api/sessions${query ? `?${query}` : ""}`);
}

// ---------- 工作台增强接口 ----------

export interface ActiveProject {
  id: string;
  name: string;
  description: string;
  task_count: number;
  running_count: number;
  last_active: string | null;
}

export interface ActivityEvent {
  id: number;
  event_type: string;
  task_id: string | null;
  task_title: string | null;
  project_name: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
}

export interface TaskStatusDistribution {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  review: number;
  [key: string]: number;
}

export interface UpcomingSchedule {
  id: string;
  name: string;
  schedule_type: string;
  next_run_at: string | null;
  last_run_at: string | null;
  enabled: boolean;
  run_count: number;
}

export function fetchActiveProjects(limit = 5): Promise<ActiveProject[]> {
  return apiClient.get<ActiveProject[]>(
    `/api/dashboard/active-projects?limit=${limit}`,
  );
}

export function fetchActivityTimeline(
  limit = 15,
): Promise<ActivityEvent[]> {
  return apiClient.get<ActivityEvent[]>(
    `/api/dashboard/activity-timeline?limit=${limit}`,
  );
}

export function fetchTaskStatusDistribution(): Promise<TaskStatusDistribution> {
  return apiClient.get<TaskStatusDistribution>(
    `/api/dashboard/task-status-distribution`,
  );
}

export function fetchUpcomingSchedules(
  limit = 5,
): Promise<UpcomingSchedule[]> {
  return apiClient.get<UpcomingSchedule[]>(
    `/api/dashboard/upcoming-schedules?limit=${limit}`,
  );
}
