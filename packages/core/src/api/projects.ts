import { apiClient } from "./client";

export interface ProjectDetail {
  id: string;
  name: string;
  cwd: string;
  task_count: number;
  running_tasks: number;
  last_active: string | null;
  status: "active" | "idle";
  agents: string[];
  session_count: number;
  /**
   * 项目维度的 Chats 数量。
   * - 列表接口 ``GET /api/projects`` 为避免性能问题不计算，返回 ``null``；
   * - 详情接口 ``GET /api/projects/{id}`` 返回精确计算后的数字。
   */
  chat_count: number | null;
  registered: boolean;
  tags: string[];
  archived?: boolean;
}

export interface ProjectSession {
  id?: string;
  session_id: string;
  agent_id: string | null;
  cwd: string | null;
  project_root: string | null;
  project_name: string | null;
  title: string | null;
  status: string;
  last_active: string | null;
  created_at: string | null;
  file?: string;
  source: string;
}

export interface ProjectSessionsResponse {
  sessions: ProjectSession[];
  project_id: string;
  cwd: string;
}

export interface ProjectChatsResponse {
  chats: ProjectSession[];
  project_id: string;
  cwd: string;
}

export interface ProjectTaskSummary {
  id: string;
  prompt: string;
  agent_id: string | null;
  status: string;
  created_at: string | null;
}

export interface ProjectTasksResponse {
  tasks: ProjectTaskSummary[];
}

export interface CreateProjectInput {
  cwd: string;
  name?: string;
  tags?: string[];
  /** 为 true 时，路径不存在会被后端 mkdir -p 创建（新建项目场景）。 */
  create_dir?: boolean;
}

export interface ProjectRootsResponse {
  roots: string[];
  default: string | null;
}

export function getProject(projectId: string): Promise<ProjectDetail> {
  return apiClient.get<ProjectDetail>(
    `/api/projects/${encodeURIComponent(projectId)}`
  );
}

export function getProjectSessions(
  projectId: string,
  agent_id?: string
): Promise<ProjectSessionsResponse> {
  const qs = agent_id ? `?agent_id=${encodeURIComponent(agent_id)}` : "";
  return apiClient.get<ProjectSessionsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/sessions${qs}`
  );
}

export function getProjectChats(
  projectId: string,
  agent_id?: string
): Promise<ProjectChatsResponse> {
  const qs = agent_id ? `?agent_id=${encodeURIComponent(agent_id)}` : "";
  return apiClient.get<ProjectChatsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/chats${qs}`
  );
}

export function getProjectTasks(
  projectId: string
): Promise<ProjectTasksResponse> {
  return apiClient.get<ProjectTasksResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/tasks`
  );
}

export function createProject(body: CreateProjectInput): Promise<ProjectDetail> {
  return apiClient.post<ProjectDetail>("/api/projects", body);
}

export function getProjectRoots(): Promise<ProjectRootsResponse> {
  return apiClient.get<ProjectRootsResponse>("/api/projects/roots");
}

export function deleteProject(projectId: string): Promise<{ removed: boolean; cwd: string }> {
  return apiClient.del<{ removed: boolean; cwd: string }>(
    `/api/projects/${encodeURIComponent(projectId)}`
  );
}

export interface ArchiveProjectResult {
  archived: boolean;
  changed: boolean;
  id: string;
  cwd: string;
}

export function archiveProject(projectId: string): Promise<ArchiveProjectResult> {
  return apiClient.post<ArchiveProjectResult>(
    `/api/projects/${encodeURIComponent(projectId)}/archive`,
    {}
  );
}

export function unarchiveProject(projectId: string): Promise<ArchiveProjectResult> {
  return apiClient.post<ArchiveProjectResult>(
    `/api/projects/${encodeURIComponent(projectId)}/unarchive`,
    {}
  );
}

/**
 * URL-safe base64 编码（不带 ``=`` padding）
 * 用于在客户端把 cwd 转成 project_id（与后端 ``_encode_id`` 保持一致）。
 */
export function encodeProjectId(cwd: string): string {
  if (typeof window === "undefined") {
    return Buffer.from(cwd, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  const utf8 = new TextEncoder().encode(cwd);
  let bin = "";
  utf8.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
