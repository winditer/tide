import { apiClient } from "./client";
import type {
  WorkItem,
  WorkItemCreate,
  WorkItemUpdate,
  WorkItemTransition,
  WorkItemBoard,
  ProjectSettings,
  WorkItemArtifact,
  CrossRepoResultsResponse,
  WorkItemAttachment,
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
  group_id?: string;
}

export function getWorkItems(projectId?: string, filters?: WorkItemFilters): Promise<WorkItem[]> {
  const qs = buildQuery({
    project_id: projectId,
    search: filters?.search,
    status: filters?.status,
    assignee: filters?.assignee,
    version_id: filters?.version_id,
    group_id: filters?.group_id,
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

// ---------- 跨仓库执行结果聚合 ----------

export function getWorkItemCrossRepoResults(
  id: string
): Promise<CrossRepoResultsResponse> {
  return apiClient.get<CrossRepoResultsResponse>(
    `/api/work-items/${id}/cross-repo-results`
  );
}

// ---------- 看板 ----------

export function getWorkItemBoard(
  projectId: string,
  versionId?: string,
  filters?: WorkItemFilters,
): Promise<WorkItemBoard> {
  const qs = buildQuery({
    project_id: projectId,
    version_id: versionId,
    status: filters?.status,
    search: filters?.search,
    assignee: filters?.assignee,
    group_id: filters?.group_id,
  });
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

// ---------- 附件 (Attachments) ----------

export interface UploadWorkItemAttachmentsResponse {
  attachments: WorkItemAttachment[];
}

export async function uploadWorkItemAttachments(
  itemId: string,
  files: File[],
): Promise<UploadWorkItemAttachmentsResponse> {
  if (!files.length) {
    return { attachments: [] };
  }
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  return apiClient.postRaw<UploadWorkItemAttachmentsResponse>(
    `/api/work-items/${encodeURIComponent(itemId)}/attachments`,
    formData,
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

// ---------- AI 分解需求 ----------

/** AI 分解返回的单条候选工作项条目（尚未持久化） */
export interface AIDecomposedItem {
  title: string;
  description: string;
  priority: number;
  tags: string[];
}

export interface AIDecomposeResponse {
  items: AIDecomposedItem[];
  raw_analysis?: string;
  skipped_files?: string[];
}

/**
 * 调用 AI 分解需求接口（multipart/form-data）。
 *
 * 表单字段约定：
 * - ``text``        : 长文本需求（可选）
 * - ``links``       : JSON 数组字符串，如 ``["https://..."]``（可选）
 * - ``project_id``  : 项目 id（必填）
 * - ``group_id``    : 项目组 id（可选）
 * - ``files``       : 上传文件，可重复（可选）
 */
export function aiDecomposeWorkItems(
  data: FormData,
): Promise<AIDecomposeResponse> {
  // 使用 postRaw 以保留鉴权头注入；FormData 由浏览器自动设置 Content-Type+boundary
  return apiClient.postRaw<AIDecomposeResponse>(
    "/api/work-items/ai-decompose",
    data,
  );
}

export interface BatchCreateWorkItemsPayload {
  items: Array<{
    title: string;
    description: string;
    priority: number;
    tags: string[];
  }>;
  project_id: string;
  group_id?: string;
}

export interface BatchCreateWorkItemsResponse {
  created: WorkItem[];
  failed: Array<{ index: number; title: string; error: string }>;
}

/** 批量创建工作项 */
export function batchCreateWorkItems(
  payload: BatchCreateWorkItemsPayload,
): Promise<BatchCreateWorkItemsResponse> {
  return apiClient.post<BatchCreateWorkItemsResponse>(
    "/api/work-items/batch",
    payload,
  );
}

// ---------- 合并冲突解决 ----------

export interface ResolveMergeParams {
  resolved: boolean;
  message?: string;
}

export interface ResolveMergeResponse {
  ok: boolean;
  work_item_id: string;
}

/** 完成工作项的合并冲突解决（推进/放弃） */
export function resolveMerge(
  workItemId: string,
  data: ResolveMergeParams,
): Promise<ResolveMergeResponse> {
  return apiClient.post<ResolveMergeResponse>(
    `/api/work-items/${workItemId}/resolve-merge`,
    data,
  );
}

// ---------- AI 优化描述 ----------

export interface OptimizeDescriptionParams {
  description: string;
  agent_id?: string;
}

export interface OptimizeDescriptionResponse {
  optimized: string;
  agent_id: string;
}

/** 调用 AI 优化工作项描述 */
export function optimizeDescription(
  params: OptimizeDescriptionParams,
): Promise<OptimizeDescriptionResponse> {
  return apiClient.post<OptimizeDescriptionResponse>(
    "/api/work-items/optimize-description",
    params,
  );
}
