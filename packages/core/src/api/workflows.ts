import { apiClient } from "./client";
import type {
  Workflow,
  WorkflowRun,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  RunWorkflowInput,
} from "../types/workflow";

export interface ListWorkflowsResponse {
  items: Workflow[];
  total: number;
}

export interface ListWorkflowRunsResponse {
  items: WorkflowRun[];
  total: number;
}

export function fetchWorkflows(): Promise<ListWorkflowsResponse> {
  return apiClient.get<ListWorkflowsResponse>("/api/workflows");
}

export function fetchWorkflow(id: string): Promise<Workflow> {
  return apiClient.get<Workflow>(`/api/workflows/${id}`);
}

export function createWorkflow(params: CreateWorkflowInput): Promise<Workflow> {
  return apiClient.post<Workflow>("/api/workflows", params);
}

export function updateWorkflow(
  id: string,
  params: UpdateWorkflowInput
): Promise<Workflow> {
  return apiClient.put<Workflow>(`/api/workflows/${id}`, params);
}

export function deleteWorkflow(id: string): Promise<void> {
  return apiClient.del<void>(`/api/workflows/${id}`);
}

export function toggleWorkflow(id: string): Promise<Workflow> {
  return apiClient.patch<Workflow>(`/api/workflows/${id}/toggle`);
}

export function duplicateWorkflow(id: string): Promise<Workflow> {
  return apiClient.post<Workflow>(`/api/workflows/${id}/duplicate`);
}

export function setDefaultWorkflow(id: string): Promise<Workflow> {
  return apiClient.put<Workflow>(`/api/workflows/${id}/set-default`);
}

export function runWorkflow(
  id: string,
  body?: RunWorkflowInput
): Promise<WorkflowRun> {
  return apiClient.post<WorkflowRun>(`/api/workflows/${id}/run`, body ?? {});
}

export function fetchWorkflowRuns(
  id: string
): Promise<ListWorkflowRunsResponse | WorkflowRun[]> {
  return apiClient.get<ListWorkflowRunsResponse | WorkflowRun[]>(
    `/api/workflows/${id}/runs`
  );
}

export function fetchWorkflowRun(
  id: string,
  runId: string
): Promise<WorkflowRun> {
  return apiClient.get<WorkflowRun>(`/api/workflows/${id}/runs/${runId}`);
}

export function cancelRun(id: string, runId: string): Promise<WorkflowRun> {
  return apiClient.post<WorkflowRun>(
    `/api/workflows/${id}/runs/${runId}/cancel`
  );
}

export function approveNode(
  id: string,
  runId: string,
  nodeId: string
): Promise<WorkflowRun> {
  return apiClient.post<WorkflowRun>(
    `/api/workflows/${id}/runs/${runId}/nodes/${nodeId}/approve`
  );
}

export function rejectNode(
  id: string,
  runId: string,
  nodeId: string
): Promise<WorkflowRun> {
  return apiClient.post<WorkflowRun>(
    `/api/workflows/${id}/runs/${runId}/nodes/${nodeId}/reject`
  );
}
