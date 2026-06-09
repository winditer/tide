import type { CreateWorkflowInput, UpdateWorkflowInput, RunWorkflowInput, WorkflowRun } from "../types/workflow";
export declare function useWorkflows(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListWorkflowsResponse>, Error>;
export declare function useWorkflow(id: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").Workflow>, Error>;
export declare function useCreateWorkflow(): import("@tanstack/react-query").UseMutationResult<import("..").Workflow, Error, CreateWorkflowInput, unknown>;
export declare function useUpdateWorkflow(): import("@tanstack/react-query").UseMutationResult<import("..").Workflow, Error, {
    id: string;
    params: UpdateWorkflowInput;
}, unknown>;
export declare function useDeleteWorkflow(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export declare function useRunWorkflow(): import("@tanstack/react-query").UseMutationResult<WorkflowRun, Error, {
    id: string;
    body?: RunWorkflowInput;
}, unknown>;
export declare function useWorkflowRuns(id: string, refetchInterval?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<WorkflowRun[]>, Error>;
export declare function useWorkflowRun(id: string, runId: string, refetchInterval?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<WorkflowRun>, Error>;
export declare function useCancelRun(): import("@tanstack/react-query").UseMutationResult<WorkflowRun, Error, {
    id: string;
    runId: string;
}, unknown>;
export declare function useApproveNode(): import("@tanstack/react-query").UseMutationResult<WorkflowRun, Error, {
    id: string;
    runId: string;
    nodeId: string;
}, unknown>;
export declare function useRejectNode(): import("@tanstack/react-query").UseMutationResult<WorkflowRun, Error, {
    id: string;
    runId: string;
    nodeId: string;
}, unknown>;
//# sourceMappingURL=use-workflows.d.ts.map