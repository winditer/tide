import type { Workflow, WorkflowRun, CreateWorkflowInput, UpdateWorkflowInput, RunWorkflowInput } from "../types/workflow";
export interface ListWorkflowsResponse {
    items: Workflow[];
    total: number;
}
export interface ListWorkflowRunsResponse {
    items: WorkflowRun[];
    total: number;
}
export declare function fetchWorkflows(): Promise<ListWorkflowsResponse>;
export declare function fetchWorkflow(id: string): Promise<Workflow>;
export declare function createWorkflow(params: CreateWorkflowInput): Promise<Workflow>;
export declare function updateWorkflow(id: string, params: UpdateWorkflowInput): Promise<Workflow>;
export declare function deleteWorkflow(id: string): Promise<void>;
export declare function toggleWorkflow(id: string): Promise<Workflow>;
export declare function runWorkflow(id: string, body?: RunWorkflowInput): Promise<WorkflowRun>;
export declare function fetchWorkflowRuns(id: string): Promise<ListWorkflowRunsResponse | WorkflowRun[]>;
export declare function fetchWorkflowRun(id: string, runId: string): Promise<WorkflowRun>;
export declare function cancelRun(id: string, runId: string): Promise<WorkflowRun>;
export declare function approveNode(id: string, runId: string, nodeId: string): Promise<WorkflowRun>;
export declare function rejectNode(id: string, runId: string, nodeId: string): Promise<WorkflowRun>;
//# sourceMappingURL=workflows.d.ts.map