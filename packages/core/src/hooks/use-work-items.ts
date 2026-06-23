import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getWorkItemBoard,
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  moveWorkItem,
  getWorkItemTransitions,
  getWorkItems,
  getWorkItem,
  getProjectWorkflow,
  bindProjectWorkflow,
  unbindProjectWorkflow,
  addArtifact,
  removeArtifact,
  type WorkItemFilters,
} from "../api/work-items";
import type {
  WorkItemCreate,
  WorkItemUpdate,
  ProjectSettings,
} from "../types/work-item";

export function useWorkItemBoard(
  projectId: string | undefined,
  versionId?: string,
  refetchInterval?: number,
) {
  // 默认 60s 自动刷新；传 0 表示关闭自动刷新
  const interval = refetchInterval ?? 60_000;
  return useQuery({
    queryKey: ["work-items", "board", projectId, versionId ?? null],
    queryFn: () => getWorkItemBoard(projectId!, versionId),
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
    mutationFn: ({ projectId, workflowId }: { projectId: string; workflowId: string }) =>
      bindProjectWorkflow(projectId, workflowId),
    onSuccess: (_data, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["project-workflow", projectId] });
    },
  });
}

export function useUnbindProjectWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => unbindProjectWorkflow(projectId),
    onSuccess: (_data, projectId) => {
      qc.invalidateQueries({ queryKey: ["project-workflow", projectId] });
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
