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
  WorkItemAssignment,
  WorkItemContextEntry,
  WorkItemComment,
  MentionItem,
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
  include_archived?: string;
}

export function getWorkItems(projectId?: string, filters?: WorkItemFilters): Promise<WorkItem[]> {
  const qs = buildQuery({
    project_id: projectId,
    search: filters?.search,
    status: filters?.status,
    assignee: filters?.assignee,
    version_id: filters?.version_id,
    group_id: filters?.group_id,
    include_archived: filters?.include_archived,
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

/** 归档工作项 */
export function archiveWorkItem(id: string): Promise<WorkItem> {
  return apiClient.patch<WorkItem>(`/api/work-items/${id}/archive`);
}

/** 取消归档工作项 */
export function unarchiveWorkItem(id: string): Promise<WorkItem> {
  return apiClient.patch<WorkItem>(`/api/work-items/${id}/unarchive`);
}

/** Freeform 模式下手动更新工作项状态（用于看板拖拽） */
export function updateWorkItemStatus(
  itemId: string,
  status: string
): Promise<WorkItem> {
  return apiClient.patch<WorkItem>(
    `/api/work-items/${encodeURIComponent(itemId)}/status`,
    { status }
  );
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
  workflowId?: string | null,
  flowMode?: string
): Promise<ProjectSettings> {
  return apiClient.put<ProjectSettings>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow`,
    { workflow_id: workflowId ?? null, flow_mode: flowMode }
  );
}

export function unbindProjectWorkflow(projectId: string): Promise<void> {
  return apiClient.del<void>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow`
  );
}

// ---------- freeform 状态列表配置 ----------

export interface FreeformStatusItem {
  key: string;
  label: string;
}

export function getFreeformStatusList(
  projectId: string
): Promise<FreeformStatusItem[]> {
  return apiClient
    .get<{ status_list: FreeformStatusItem[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/freeform-status`
    )
    .then((r) => r.status_list ?? []);
}

export function setFreeformStatusList(
  projectId: string,
  statusList: FreeformStatusItem[]
): Promise<FreeformStatusItem[]> {
  return apiClient
    .put<{ status_list: FreeformStatusItem[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/freeform-status`,
      { status_list: statusList }
    )
    .then((r) => r.status_list ?? []);
}

// ---------- 全局 freeform 状态列表配置（与项目无关） ----------

export function getGlobalFreeformStatus(): Promise<FreeformStatusItem[]> {
  return apiClient
    .get<{ status_list: FreeformStatusItem[] }>(`/api/settings/freeform-status`)
    .then((r) => r.status_list ?? []);
}

export function setGlobalFreeformStatus(
  statusList: FreeformStatusItem[]
): Promise<FreeformStatusItem[]> {
  return apiClient
    .put<{ status_list: FreeformStatusItem[] }>(`/api/settings/freeform-status`, {
      status_list: statusList,
    })
    .then((r) => r.status_list ?? []);
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

/** 删除工作项附件 */
export function deleteWorkItemAttachment(
  itemId: string,
  attachmentId: string,
): Promise<{ attachments: WorkItemAttachment[] }> {
  return apiClient.del<{ attachments: WorkItemAttachment[] }>(
    `/api/work-items/${encodeURIComponent(itemId)}/attachments/${encodeURIComponent(attachmentId)}`,
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

// ---------- Freeform 分配 & 共享上下文 ----------

export interface AssignWorkItemParams {
  target_type: "member" | "expert_team" | "squad";
  target_id: string;
  role?: string;
}

/** 获取工作项分配列表 */
export function getWorkItemAssignments(
  workItemId: string,
): Promise<WorkItemAssignment[]> {
  return apiClient.get<WorkItemAssignment[]>(
    `/api/work-items/${encodeURIComponent(workItemId)}/assignments`,
  );
}

/** 分配工作项给成员/专家团/小队 */
export function assignWorkItem(
  workItemId: string,
  params: AssignWorkItemParams,
): Promise<WorkItemAssignment> {
  return apiClient.post<WorkItemAssignment>(
    `/api/work-items/${encodeURIComponent(workItemId)}/assign`,
    params,
  );
}

/** 更新分配状态（接受 / 进行中 / 完成 / 拒绝） */
export function updateWorkItemAssignment(
  workItemId: string,
  assignmentId: string,
  data: { status: string; notes?: string },
): Promise<WorkItemAssignment> {
  return apiClient.patch<WorkItemAssignment>(
    `/api/work-items/${encodeURIComponent(workItemId)}/assignments/${encodeURIComponent(
      assignmentId,
    )}`,
    data,
  );
}

/** 获取工作项共享上下文流（时间正序） */
export function getWorkItemContext(
  workItemId: string,
): Promise<WorkItemContextEntry[]> {
  return apiClient.get<WorkItemContextEntry[]>(
    `/api/work-items/${encodeURIComponent(workItemId)}/context`,
  );
}

/** 添加工作项共享上下文条目 */
export function addWorkItemContext(
  workItemId: string,
  data: { context_type: string; content: string },
): Promise<WorkItemContextEntry> {
  return apiClient.post<WorkItemContextEntry>(
    `/api/work-items/${encodeURIComponent(workItemId)}/context`,
    data,
  );
}

// ---------- Freeform 评论协作 ----------

/** 获取工作项评论列表（时间正序） */
export function getWorkItemComments(
  workItemId: string,
): Promise<WorkItemComment[]> {
  return apiClient.get<WorkItemComment[]>(
    `/api/work-items/${encodeURIComponent(workItemId)}/comments`,
  );
}

/** 创建评论；若 mentions 含专家团/小队则触发 Agent 执行 */
export function createWorkItemComment(
  workItemId: string,
  data: { content: string; mentions?: MentionItem[]; skills?: {slug: string, name: string}[] },
): Promise<WorkItemComment> {
  return apiClient.post<WorkItemComment>(
    `/api/work-items/${encodeURIComponent(workItemId)}/comments`,
    data,
  );
}
