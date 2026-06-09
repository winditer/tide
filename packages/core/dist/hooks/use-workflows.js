import { useQuery, useMutation, useQueryClient, } from "@tanstack/react-query";
import { fetchWorkflows, fetchWorkflow, createWorkflow, updateWorkflow, deleteWorkflow, runWorkflow, fetchWorkflowRuns, fetchWorkflowRun, cancelRun, approveNode, rejectNode, } from "../api/workflows";
export function useWorkflows() {
    return useQuery({
        queryKey: ["workflows"],
        queryFn: () => fetchWorkflows(),
    });
}
export function useWorkflow(id) {
    return useQuery({
        queryKey: ["workflow", id],
        queryFn: () => fetchWorkflow(id),
        enabled: !!id,
    });
}
export function useCreateWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (params) => createWorkflow(params),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["workflows"] });
        },
    });
}
export function useUpdateWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, params }) => updateWorkflow(id, params),
        onSuccess: (_data, { id }) => {
            qc.invalidateQueries({ queryKey: ["workflows"] });
            qc.invalidateQueries({ queryKey: ["workflow", id] });
        },
    });
}
export function useDeleteWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => deleteWorkflow(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["workflows"] });
        },
    });
}
export function useRunWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, body }) => runWorkflow(id, body),
        onSuccess: (_data, { id }) => {
            qc.invalidateQueries({ queryKey: ["workflow-runs", id] });
            qc.invalidateQueries({ queryKey: ["workflow", id] });
        },
    });
}
function normaliseRuns(data) {
    var _a;
    if (!data)
        return [];
    if (Array.isArray(data))
        return data;
    return (_a = data.items) !== null && _a !== void 0 ? _a : [];
}
export function useWorkflowRuns(id, refetchInterval) {
    return useQuery({
        queryKey: ["workflow-runs", id],
        queryFn: () => fetchWorkflowRuns(id),
        enabled: !!id,
        refetchInterval,
        select: normaliseRuns,
    });
}
export function useWorkflowRun(id, runId, refetchInterval) {
    return useQuery({
        queryKey: ["workflow-run", id, runId],
        queryFn: () => fetchWorkflowRun(id, runId),
        enabled: !!id && !!runId,
        refetchInterval,
    });
}
export function useCancelRun() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, runId }) => cancelRun(id, runId),
        onSuccess: (_data, { id, runId }) => {
            qc.invalidateQueries({ queryKey: ["workflow-runs", id] });
            qc.invalidateQueries({ queryKey: ["workflow-run", id, runId] });
        },
    });
}
export function useApproveNode() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, runId, nodeId, }) => approveNode(id, runId, nodeId),
        onSuccess: (_data, { id, runId }) => {
            qc.invalidateQueries({ queryKey: ["workflow-run", id, runId] });
        },
    });
}
export function useRejectNode() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, runId, nodeId, }) => rejectNode(id, runId, nodeId),
        onSuccess: (_data, { id, runId }) => {
            qc.invalidateQueries({ queryKey: ["workflow-run", id, runId] });
        },
    });
}
//# sourceMappingURL=use-workflows.js.map