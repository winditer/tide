import { apiClient } from "./client";
import type { Task } from "../types/task";

export interface CreateTaskParams {
  prompt: string;
  agent_id?: string;
  model?: string;
  cwd?: string;
  session_id?: string;
  attachments?: string[];
  workspace_id?: string;
  /** 项目组 id；选中项目组时由后端注入多仓库上下文 */
  group_id?: string;
}

export interface ListTasksParams {
  workspace_id?: string;
  status?: string;
  agent_id?: string;
  project?: string;
  /** 项目组 id；仅返回 DB 中属于该项目组的任务 */
  group_id?: string;
  session_id?: string;
  created_after?: string;
  created_before?: string;
  page?: number;
  page_size?: number;
}

export interface ListTasksResponse {
  items: Task[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApprovalAction {
  action: "approve" | "reject";
  reason?: string;
}

export function createTask(params: CreateTaskParams): Promise<Task> {
  return apiClient.post<Task>("/api/tasks", params);
}

export interface UploadAttachmentsResponse {
  attachments: string[];
}

const BASE_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
  "";

export async function uploadTaskAttachments(
  files: File[]
): Promise<UploadAttachmentsResponse> {
  if (!files.length) {
    return { attachments: [] };
  }
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  const response = await fetch(`${BASE_URL}/api/tasks/attachments`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    throw new Error(
      `Upload failed (${response.status}): ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`
    );
  }
  return response.json() as Promise<UploadAttachmentsResponse>;
}

export function listTasks(params?: ListTasksParams): Promise<ListTasksResponse> {
  const searchParams = new URLSearchParams();
  if (params?.workspace_id) searchParams.set("workspace_id", params.workspace_id);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.agent_id) searchParams.set("agent_id", params.agent_id);
  if (params?.project) searchParams.set("project", params.project);
  if (params?.group_id) searchParams.set("group_id", params.group_id);
  if (params?.session_id) searchParams.set("session_id", params.session_id);
  if (params?.created_after) searchParams.set("created_after", params.created_after);
  if (params?.created_before) searchParams.set("created_before", params.created_before);
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.page_size) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiClient.get<ListTasksResponse>(`/api/tasks${query ? `?${query}` : ""}`);
}

export function getTask(id: string): Promise<Task> {
  return apiClient.get<Task>(`/api/tasks/${id}`);
}

export function stopTask(id: string): Promise<Task> {
  return apiClient.post<Task>(`/api/tasks/${id}/stop`);
}

export function approveTask(id: string): Promise<Task> {
  return apiClient.post<Task>(`/api/tasks/${id}/approve`);
}

export function rejectTask(id: string, body?: ApprovalAction): Promise<Task> {
  return apiClient.post<Task>(`/api/tasks/${id}/reject`, body);
}

export function retryTask(id: string): Promise<Task> {
  return apiClient.post<Task>(`/api/tasks/${id}/retry`);
}
