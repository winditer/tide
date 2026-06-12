import { apiClient } from "./client";
import type {
  WorkItem,
  WorkItemCreate,
  WorkItemUpdate,
  WorkItemTransition,
  WorkItemBoard,
  ProjectSettings,
  WorkItemArtifact,
} from "../types/work-item";

function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// ---------- 工作项 CRUD ----------

export interface WorkItemFilters {
  search?: string;
  status?: string;
  assignee?: string;
  version_id?: string;
}

export function getWorkItems(projectId?: string, filters?: WorkItemFilters): Promise<WorkItem[]> {
  const qs = buildQuery({
    project_id: projectId,
    search: filters?.search,
    status: filters?.status,
    assignee: filters?.assignee,
    version_id: filters?.version_id,
  });
  return apiClient.get<WorkItem[]>(`/api/work-items${qs}`);
}

export function getWorkItem(id: string): Promise<WorkItem> {
  return apiClient.get<WorkItem>(`/api/work-items/${id}`);
}

export function createWorkItem(data: WorkItemCreate): Promise<WorkItem> {
  return apiClient.post<WorkItem>("/api/work-items", data);
}

export function updateWorkItem(
  id: string,
  data: WorkItemUpdate
): Promise<WorkItem> {
  return apiClient.patch<WorkItem>(`/api/work-items/${id}`, data);
}

export function deleteWorkItem(id: string): Promise<void> {
  return apiClient.del<void>(`/api/work-items/${id}`);
}

// ---------- 流转 ----------

export function transitionWorkItem(
  id: string,
  targetNodeId: string,
  operator?: string
): Promise<WorkItemTransition> {
  return apiClient.post<WorkItemTransition>(
    `/api/work-items/${id}/transition`,
    { target_node_id: targetNodeId, operator }
  );
}

export function getWorkItemTransitions(
  id: string
): Promise<WorkItemTransition[]> {
  return apiClient.get<WorkItemTransition[]>(
    `/api/work-items/${id}/transitions`
  );
}

// ---------- 看板 ----------

export function getWorkItemBoard(
  projectId: string,
  versionId?: string,
): Promise<WorkItemBoard> {
  const qs = buildQuery({ project_id: projectId, version_id: versionId });
  return apiClient.get<WorkItemBoard>(`/api/kanban/work-items${qs}`);
}

export function moveWorkItem(
  id: string,
  targetNodeId: string
): Promise<WorkItemTransition> {
  return apiClient.post<WorkItemTransition>(
    `/api/kanban/work-items/${id}/move`,
    { target_node_id: targetNodeId }
  );
}

// ---------- 项目-工作流绑定 ----------

export function getProjectWorkflow(
  projectId: string
): Promise<ProjectSettings> {
  return apiClient.get<ProjectSettings>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow`
  );
}

export function bindProjectWorkflow(
  projectId: string,
  workflowId: string
): Promise<ProjectSettings> {
  return apiClient.put<ProjectSettings>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow`,
    { workflow_id: workflowId }
  );
}

export function unbindProjectWorkflow(projectId: string): Promise<void> {
  return apiClient.del<void>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow`
  );
}

// ---------- 产物 (Artifacts) ----------

export function addArtifact(
  workItemId: string,
  data: { label: string; url: string; stage?: string; type?: string }
): Promise<{ artifacts: WorkItemArtifact[] }> {
  return apiClient.post<{ artifacts: WorkItemArtifact[] }>(
    `/api/work-items/${workItemId}/artifacts`,
    data
  );
}

export function removeArtifact(
  workItemId: string,
  artifactId: string
): Promise<{ artifacts: WorkItemArtifact[] }> {
  return apiClient.del<{ artifacts: WorkItemArtifact[] }>(
    `/api/work-items/${workItemId}/artifacts/${artifactId}`
  );
}
