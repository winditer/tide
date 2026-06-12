import { apiClient } from "./client";

/** 版本状态：active（活跃）/ released（已发布）/ archived（已归档） */
export type VersionStatus = "active" | "released" | "archived";

export interface Version {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  status: VersionStatus | string;
  created_at: string;
  updated_at: string;
}

export interface CreateVersionInput {
  project_id: string;
  name: string;
  description?: string;
  status?: VersionStatus | string;
}

export interface UpdateVersionInput {
  name?: string;
  description?: string;
  status?: VersionStatus | string;
}

function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      search.set(k, v);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function getVersions(projectId?: string): Promise<Version[]> {
  return apiClient.get<Version[]>(
    `/api/versions${buildQuery({ project_id: projectId })}`,
  );
}

export function createVersion(data: CreateVersionInput): Promise<Version> {
  return apiClient.post<Version>("/api/versions", data);
}

export function updateVersion(
  id: string,
  data: UpdateVersionInput,
): Promise<Version> {
  return apiClient.patch<Version>(`/api/versions/${id}`, data);
}

export function deleteVersion(id: string): Promise<void> {
  return apiClient.del<void>(`/api/versions/${id}`);
}
