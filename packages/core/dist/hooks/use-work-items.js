import { useQuery, useMutation, useQueryClient, } from "@tanstack/react-query";
import { getWorkItemBoard, createWorkItem, updateWorkItem, deleteWorkItem, moveWorkItem, getWorkItemTransitions, getWorkItems, getWorkItem, getWorkItemCrossRepoResults, getProjectWorkflow, bindProjectWorkflow, unbindProjectWorkflow, addArtifact, removeArtifact, } from "../api/work-items";
export function useWorkItemBoard(projectId, versionId, refetchInterval) {
    // 默认 60s 自动刷新；传 0 表示关闭自动刷新
    const interval = refetchInterval !== null && refetchInterval !== void 0 ? refetchInterval : 60000;
    return useQuery({
        queryKey: ["work-items", "board", projectId, versionId !== null && versionId !== void 0 ? versionId : null],
        queryFn: () => getWorkItemBoard(projectId, versionId),
        enabled: !!projectId,
        refetchInterval: interval > 0 ? interval : false,
        refetchIntervalInBackground: false,
    });
}
export function useWorkItems(projectId, filters) {
    return useQuery({
        queryKey: ["work-items", "list", projectId, filters],
        queryFn: () => getWorkItems(projectId, filters),
    });
}
export function useWorkItem(id) {
    return useQuery({
        queryKey: ["work-items", "detail", id],
        queryFn: () => getWorkItem(id),
        enabled: !!id,
    });
}
export function useWorkItemTransitions(id) {
    return useQuery({
        queryKey: ["work-items", "transitions", id],
        queryFn: () => getWorkItemTransitions(id),
        enabled: !!id,
    });
}
export function useWorkItemCrossRepoResults(id) {
    return useQuery({
        queryKey: ["work-items", "cross-repo-results", id],
        queryFn: () => getWorkItemCrossRepoResults(id),
        enabled: !!id,
    });
}
export function useCreateWorkItem() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data) => createWorkItem(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-items"] });
        },
    });
}
export function useUpdateWorkItem() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }) => updateWorkItem(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-items"] });
        },
    });
}
export function useDeleteWorkItem() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => deleteWorkItem(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-items"] });
        },
    });
}
export function useMoveWorkItem() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, targetNodeId }) => moveWorkItem(id, targetNodeId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-items"] });
        },
    });
}
export function useProjectWorkflow(projectId) {
    return useQuery({
        queryKey: ["project-workflow", projectId],
        queryFn: () => getProjectWorkflow(projectId),
        enabled: !!projectId,
    });
}
export function useBindProjectWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ projectId, workflowId }) => bindProjectWorkflow(projectId, workflowId),
        onSuccess: (_data, { projectId }) => {
            qc.invalidateQueries({ queryKey: ["project-workflow", projectId] });
        },
    });
}
export function useUnbindProjectWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (projectId) => unbindProjectWorkflow(projectId),
        onSuccess: (_data, projectId) => {
            qc.invalidateQueries({ queryKey: ["project-workflow", projectId] });
        },
    });
}
export function useAddArtifact() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ workItemId, data, }) => addArtifact(workItemId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-items"] });
        },
    });
}
export function useRemoveArtifact() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ workItemId, artifactId, }) => removeArtifact(workItemId, artifactId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-items"] });
        },
    });
}
//# sourceMappingURL=use-work-items.js.map