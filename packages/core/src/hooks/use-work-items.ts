import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getWorkItemBoard,
  createWorkItem,
  updateWorkItem,
  updateWorkItemStatus,
  deleteWorkItem,
  moveWorkItem,
  getWorkItemTransitions,
  getWorkItems,
  getWorkItem,
  getWorkItemCrossRepoResults,
  getProjectWorkflow,
  bindProjectWorkflow,
  unbindProjectWorkflow,
  getFreeformStatusList,
  setFreeformStatusList,
  getGlobalFreeformStatus,
  setGlobalFreeformStatus,
  addArtifact,
  removeArtifact,
  aiDecomposeWorkItems,
  batchCreateWorkItems,
  resolveMerge,
  optimizeDescription,
  getWorkItemAssignments,
  assignWorkItem,
  updateWorkItemAssignment,
  getWorkItemContext,
  addWorkItemContext,
  getWorkItemComments,
  createWorkItemComment,
  type WorkItemFilters,
  type BatchCreateWorkItemsPayload,
  type ResolveMergeParams,
  type OptimizeDescriptionParams,
  type AssignWorkItemParams,
  type FreeformStatusItem,
} from "../api/work-items";
import type {
  WorkItemCreate,
  WorkItemUpdate,
  MentionItem,
} from "../types/work-item";

export function useWorkItemBoard(
  projectId: string | undefined,
  versionId?: string,
  refetchInterval?: number,
  filters?: WorkItemFilters,
) {
  // 默认 60s 自动刷新；传 0 表示关闭自动刷新
  const interval = refetchInterval ?? 60_000;
  return useQuery({
    queryKey: ["work-items", "board", projectId, versionId ?? null, filters ?? null],
    queryFn: () => getWorkItemBoard(projectId!, versionId, filters),
    enabled: !!projectId,
    refetchInterval: interval > 0 ? interval : false,
    refetchIntervalInBackground: false,
  });
}

export function useWorkItems(projectId?: string, filters?: WorkItemFilters) {
  return useQuery({
    queryKey: ["work-items", "list", projectId, filters],
    queryFn: () => getWorkItems(projectId, filters),
  });
}

export function useWorkItem(id: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "detail", id],
    queryFn: () => getWorkItem(id!),
    enabled: !!id,
  });
}

export function useWorkItemTransitions(id: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "transitions", id],
    queryFn: () => getWorkItemTransitions(id!),
    enabled: !!id,
  });
}

export function useWorkItemCrossRepoResults(id: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "cross-repo-results", id],
    queryFn: () => getWorkItemCrossRepoResults(id!),
    enabled: !!id,
  });
}

export function useCreateWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: WorkItemCreate) => createWorkItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useUpdateWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: WorkItemUpdate }) =>
      updateWorkItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useDeleteWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWorkItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

/** Freeform 看板拖拽：手动更新工作项状态 */
export function useUpdateWorkItemStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: string }) =>
      updateWorkItemStatus(itemId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useMoveWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetNodeId }: { id: string; targetNodeId: string }) =>
      moveWorkItem(id, targetNodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useProjectWorkflow(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-workflow", projectId],
    queryFn: () => getProjectWorkflow(projectId!),
    enabled: !!projectId,
  });
}

export function useBindProjectWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      workflowId,
      flowMode,
    }: {
      projectId: string;
      workflowId?: string | null;
      flowMode?: string;
    }) => bindProjectWorkflow(projectId, workflowId, flowMode),
    onSuccess: (_data, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["project-workflow", projectId] });
      // flow_mode 变更后看板列结构随之改变，需失效看板与列表缓存以重新拉取
      qc.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useUnbindProjectWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => unbindProjectWorkflow(projectId),
    onSuccess: (_data, projectId) => {
      // 解绑后后端 GET /workflow 会返回 404，react-query 默认会保留上一次的旧数据，
      // 导致页面仍显示已绑定的工作流。直接移除缓存以清空绑定状态并触发重拉。
      qc.removeQueries({ queryKey: ["project-workflow", projectId] });
      qc.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useFreeformStatusList(projectId?: string) {
  return useQuery({
    queryKey: ["freeform-status", projectId],
    queryFn: () => getFreeformStatusList(projectId!),
    enabled: !!projectId,
  });
}

export function useSetFreeformStatusList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      statusList,
    }: {
      projectId: string;
      statusList: FreeformStatusItem[];
    }) => setFreeformStatusList(projectId, statusList),
    onSuccess: (_data, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["freeform-status", projectId] });
      // 状态列变更后看板列结构随之改变，需失效看板缓存
      qc.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

/**
 * 获取全局 freeform 状态列配置（与项目无关）。
 * 未选择具体项目时的全局视图与未做项目级配置的 fallback 都依赖它。
 */
export function useGlobalFreeformStatusList() {
  return useQuery({
    queryKey: ["freeform-status", "__global__"],
    queryFn: () => getGlobalFreeformStatus(),
  });
}

/** 保存全局 freeform 状态列配置（仅 admin）。 */
export function useSetGlobalFreeformStatusList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (statusList: FreeformStatusItem[]) =>
      setGlobalFreeformStatus(statusList),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["freeform-status"] });
      qc.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useAddArtifact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      data,
    }: {
      workItemId: string;
      data: { label: string; url: string; stage?: string };
    }) => addArtifact(workItemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useRemoveArtifact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      artifactId,
    }: {
      workItemId: string;
      artifactId: string;
    }) => removeArtifact(workItemId, artifactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

/**
 * AI 分解需求：调用后端解析文本/链接/文件，返回候选工作项列表（不入库）。
 * 调用方应在用户确认后再使用 ``useBatchCreateWorkItems`` 持久化。
 */
export function useAIDecompose() {
  return useMutation({
    mutationFn: (data: FormData) => aiDecomposeWorkItems(data),
  });
}

/** 批量创建工作项；成功后失效 work-items 查询。 */
export function useBatchCreateWorkItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BatchCreateWorkItemsPayload) =>
      batchCreateWorkItems(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

/** 完成合并冲突解决（推进或放弃合并）。 */
export function useResolveMerge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      data,
    }: {
      workItemId: string;
      data: ResolveMergeParams;
    }) => resolveMerge(workItemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

/** AI 优化工作项描述 */
export function useOptimizeDescription() {
  return useMutation({
    mutationFn: (params: OptimizeDescriptionParams) => optimizeDescription(params),
  });
}

// ---------- Freeform 分配 & 共享上下文 ----------

/** 获取工作项分配列表 */
export function useWorkItemAssignments(id: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "assignments", id],
    queryFn: () => getWorkItemAssignments(id!),
    enabled: !!id,
  });
}

/** 获取工作项共享上下文流 */
export function useWorkItemContext(id: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "context", id],
    queryFn: () => getWorkItemContext(id!),
    enabled: !!id,
  });
}

/** 分配工作项；成功后失效分配查询 */
export function useAssignWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      params,
    }: {
      workItemId: string;
      params: AssignWorkItemParams;
    }) => assignWorkItem(workItemId, params),
    onSuccess: (_data, { workItemId }) => {
      queryClient.invalidateQueries({ queryKey: ["work-items", "assignments", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

/** 更新分配状态（接受 / 完成 / 拒绝等） */
export function useUpdateWorkItemAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      assignmentId,
      status,
      notes,
    }: {
      workItemId: string;
      assignmentId: string;
      status: string;
      notes?: string;
    }) => updateWorkItemAssignment(workItemId, assignmentId, { status, notes }),
    onSuccess: (_data, { workItemId }) => {
      queryClient.invalidateQueries({ queryKey: ["work-items", "assignments", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

/** 添加共享上下文条目 */
export function useAddWorkItemContext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      contextType,
      content,
    }: {
      workItemId: string;
      contextType: string;
      content: string;
    }) => addWorkItemContext(workItemId, { context_type: contextType, content }),
    onSuccess: (_data, { workItemId }) => {
      queryClient.invalidateQueries({ queryKey: ["work-items", "context", workItemId] });
    },
  });
}

// ---------- Freeform 评论协作 ----------

/** 获取工作项评论列表 */
export function useWorkItemComments(workItemId?: string) {
  return useQuery({
    queryKey: ["work-items", "comments", workItemId],
    queryFn: () => getWorkItemComments(workItemId!),
    enabled: !!workItemId,
  });
}

/** 创建评论；成功后失效评论查询 */
export function useCreateWorkItemComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      content,
      mentions,
    }: {
      workItemId: string;
      content: string;
      mentions?: MentionItem[];
    }) => createWorkItemComment(workItemId, { content, mentions }),
    onSuccess: (_data, { workItemId }) => {
      queryClient.invalidateQueries({ queryKey: ["work-items", "comments", workItemId] });
    },
  });
}
