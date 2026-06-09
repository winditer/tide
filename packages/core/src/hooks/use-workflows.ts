import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchWorkflows,
  fetchWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  runWorkflow,
  fetchWorkflowRuns,
  fetchWorkflowRun,
  cancelRun,
  approveNode,
  rejectNode,
} from "../api/workflows";
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  RunWorkflowInput,
  WorkflowRun,
} from "../types/workflow";
import type { ListWorkflowRunsResponse } from "../api/workflows";

export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: ["workflow", id],
    queryFn: () => fetchWorkflow(id),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWorkflowInput) => createWorkflow(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateWorkflowInput }) =>
      updateWorkflow(id, params),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow", id] });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWorkflow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

export function useRunWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: RunWorkflowInput }) =>
      runWorkflow(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["workflow-runs", id] });
      qc.invalidateQueries({ queryKey: ["workflow", id] });
    },
  });
}

function normaliseRuns(
  data: ListWorkflowRunsResponse | WorkflowRun[] | undefined
): WorkflowRun[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}

export function useWorkflowRuns(id: string, refetchInterval?: number) {
  return useQuery({
    queryKey: ["workflow-runs", id],
    queryFn: () => fetchWorkflowRuns(id),
    enabled: !!id,
    refetchInterval,
    select: normaliseRuns,
  });
}

export function useWorkflowRun(
  id: string,
  runId: string,
  refetchInterval?: number
) {
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
    mutationFn: ({ id, runId }: { id: string; runId: string }) =>
      cancelRun(id, runId),
    onSuccess: (_data, { id, runId }) => {
      qc.invalidateQueries({ queryKey: ["workflow-runs", id] });
      qc.invalidateQueries({ queryKey: ["workflow-run", id, runId] });
    },
  });
}

export function useApproveNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      runId,
      nodeId,
    }: {
      id: string;
      runId: string;
      nodeId: string;
    }) => approveNode(id, runId, nodeId),
    onSuccess: (_data, { id, runId }) => {
      qc.invalidateQueries({ queryKey: ["workflow-run", id, runId] });
    },
  });
}

export function useRejectNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      runId,
      nodeId,
    }: {
      id: string;
      runId: string;
      nodeId: string;
    }) => rejectNode(id, runId, nodeId),
    onSuccess: (_data, { id, runId }) => {
      qc.invalidateQueries({ queryKey: ["workflow-run", id, runId] });
    },
  });
}
