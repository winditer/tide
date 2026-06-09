import type { CreateTaskParams, ListTasksParams, ApprovalAction } from "../api/tasks";
export declare function useTasksQuery(params?: ListTasksParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListTasksResponse>, Error>;
export declare function useTaskQuery(id: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").Task>, Error>;
export declare function useCreateTaskMutation(): import("@tanstack/react-query").UseMutationResult<import("..").Task, Error, CreateTaskParams, unknown>;
export declare function useStopTaskMutation(): import("@tanstack/react-query").UseMutationResult<import("..").Task, Error, string, unknown>;
export declare function useApproveTaskMutation(): import("@tanstack/react-query").UseMutationResult<import("..").Task, Error, string, unknown>;
export declare function useRejectTaskMutation(): import("@tanstack/react-query").UseMutationResult<import("..").Task, Error, {
    id: string;
    body?: ApprovalAction;
}, unknown>;
export declare function useRetryTaskMutation(): import("@tanstack/react-query").UseMutationResult<import("..").Task, Error, string, unknown>;
//# sourceMappingURL=use-tasks.d.ts.map