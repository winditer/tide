import { type WorkItemFilters } from "../api/work-items";
import type { WorkItemCreate, WorkItemUpdate } from "../types/work-item";
export declare function useWorkItemBoard(projectId: string | undefined, versionId?: string, refetchInterval?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").WorkItemBoard>, Error>;
export declare function useWorkItems(projectId?: string, filters?: WorkItemFilters): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").WorkItem[]>, Error>;
export declare function useWorkItem(id: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").WorkItem>, Error>;
export declare function useWorkItemTransitions(id: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").WorkItemTransition[]>, Error>;
export declare function useWorkItemCrossRepoResults(id: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").CrossRepoResultsResponse>, Error>;
export declare function useCreateWorkItem(): import("@tanstack/react-query").UseMutationResult<import("..").WorkItem, Error, WorkItemCreate, unknown>;
export declare function useUpdateWorkItem(): import("@tanstack/react-query").UseMutationResult<import("..").WorkItem, Error, {
    id: string;
    data: WorkItemUpdate;
}, unknown>;
export declare function useDeleteWorkItem(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export declare function useMoveWorkItem(): import("@tanstack/react-query").UseMutationResult<import("..").WorkItemTransition, Error, {
    id: string;
    targetNodeId: string;
}, unknown>;
export declare function useProjectWorkflow(projectId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectSettings>, Error>;
export declare function useBindProjectWorkflow(): import("@tanstack/react-query").UseMutationResult<import("..").ProjectSettings, Error, {
    projectId: string;
    workflowId: string;
}, unknown>;
export declare function useUnbindProjectWorkflow(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export declare function useAddArtifact(): import("@tanstack/react-query").UseMutationResult<{
    artifacts: import("..").WorkItemArtifact[];
}, Error, {
    workItemId: string;
    data: {
        label: string;
        url: string;
        stage?: string;
    };
}, unknown>;
export declare function useRemoveArtifact(): import("@tanstack/react-query").UseMutationResult<{
    artifacts: import("..").WorkItemArtifact[];
}, Error, {
    workItemId: string;
    artifactId: string;
}, unknown>;
//# sourceMappingURL=use-work-items.d.ts.map