import { apiClient } from "./client";
import type { SessionInfo, SessionsResponse } from "./dashboard";

export type SessionType = "all" | "project" | "chat";

export interface ListSessionsParams {
  workspace_id?: string;
  project?: string;
  /** 项目组 id；仅返回属于该项目组的会话 */
  group_id?: string;
  agent_id?: string;
  type?: SessionType;
  page?: number;
  page_size?: number;
  show_archived?: boolean;
}

export interface ListChatsParams {
  agent_id?: string;
  page?: number;
  page_size?: number;
  show_archived?: boolean;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string | null;
  kind?: string;
}

export interface SessionRelatedTask {
  id: string;
  prompt: string | null;
  agent_id: string | null;
  status: string;
  cwd: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface SessionDetail {
  session: SessionInfo & {
    id?: string;
    file?: string | null;
    title?: string | null;
    project_root?: string | null;
    project_name?: string | null;
    created_at?: string | null;
    status?: string | null;
    source?: string;
  };
  messages: SessionMessage[];
  tasks: SessionRelatedTask[];
}

export interface CreateSessionInput {
  /** 项目工作目录；留空则创建普通对话（chat） */
  project_cwd?: string;
  agent_id?: string;
  title?: string;
  model?: string;
  workspace_id?: string;
  /** 会话类型：convo=项目会话，chat=普通对话；可以仅凭 cwd 推断 */
  session_type?: "convo" | "chat";
  /** 项目组 id；选中项目组时由后端注入多仓库上下文 */
  group_id?: string;
}

export interface CreateSessionResult {
  session_id: string;
  task_id: string | null;
  agent_id: string;
  cwd: string;
  title: string;
  status: string;
  session_type?: "convo" | "chat";
}

export interface SessionItem {
  id: string;
  title: string;
  agent_id: string;
  created_at: string;
  type: "project" | "chat";
}

export interface SessionsForProjectResponse {
  sessions: SessionItem[];
}

function buildQuery(params?: ListSessionsParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  if (params.workspace_id) search.set("workspace_id", params.workspace_id);
  if (params.project) search.set("project", params.project);
  if (params.group_id) search.set("group_id", params.group_id);
  if (params.agent_id) search.set("agent_id", params.agent_id);
  if (params.type && params.type !== "all") search.set("type", params.type);
  if (params.page) search.set("page", String(params.page));
  if (params.page_size) search.set("page_size", String(params.page_size));
  if (params.show_archived !== undefined)
    search.set("show_archived", params.show_archived ? "true" : "false");
  const q = search.toString();
  return q ? `?${q}` : "";
}

function buildChatsQuery(params?: ListChatsParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  if (params.agent_id) search.set("agent_id", params.agent_id);
  if (params.page) search.set("page", String(params.page));
  if (params.page_size) search.set("page_size", String(params.page_size));
  if (params.show_archived !== undefined)
    search.set("show_archived", params.show_archived ? "true" : "false");
  const q = search.toString();
  return q ? `?${q}` : "";
}

export function listSessions(
  params?: ListSessionsParams
): Promise<SessionsResponse> {
  return apiClient.get<SessionsResponse>(`/api/sessions${buildQuery(params)}`);
}

/** 获取普通对话（非项目会话）列表，调用 GET /api/sessions/chats */
export function listChats(
  params?: ListChatsParams
): Promise<SessionsResponse> {
  return apiClient.get<SessionsResponse>(
    `/api/sessions/chats${buildChatsQuery(params)}`
  );
}

export function getSession(
  sessionId: string,
  workspaceId = "default"
): Promise<SessionDetail> {
  const q = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return apiClient.get<SessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionId)}${q}`
  );
}

export function createSession(
  body: CreateSessionInput
): Promise<CreateSessionResult> {
  return apiClient.post<CreateSessionResult>("/api/sessions", body);
}

export function fetchSessionsForProject(
  cwd: string
): Promise<SessionsForProjectResponse> {
  const q = `?cwd=${encodeURIComponent(cwd)}`;
  return apiClient.get<SessionsForProjectResponse>(
    `/api/sessions/list-for-project${q}`
  );
}

export interface ArchiveSessionResult {
  archived: boolean;
  changed: boolean;
  id: string;
}

export function archiveSession(sessionId: string): Promise<ArchiveSessionResult> {
  return apiClient.post<ArchiveSessionResult>(
    `/api/sessions/${encodeURIComponent(sessionId)}/archive`,
    {}
  );
}

export function unarchiveSession(sessionId: string): Promise<ArchiveSessionResult> {
  return apiClient.post<ArchiveSessionResult>(
    `/api/sessions/${encodeURIComponent(sessionId)}/unarchive`,
    {}
  );
}
