import type { ListPlansParams, CreatePlanParams } from "../api/plans";
export declare function usePlans(params?: ListPlansParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").Plan[]>, Error>;
export declare function usePlan(id: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").Plan>, Error>;
export declare function usePlanDAG(id: string, options?: {
    refetchInterval?: number;
}): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").PlanDAGResponse>, Error>;
export declare function usePlanTasks(id: string, options?: {
    refetchInterval?: number;
}): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").PlanTask[]>, Error>;
export declare function usePlanTimeline(id: string, options?: {
    refetchInterval?: number;
}): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").GanttItem[]>, Error>;
export declare function useCreatePlan(): import("@tanstack/react-query").UseMutationResult<import("..").Plan, Error, CreatePlanParams, unknown>;
export declare function useStopPlan(): import("@tanstack/react-query").UseMutationResult<import("..").Plan, Error, string, unknown>;
export declare function useRetryPlanTask(planId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
//# sourceMappingURL=use-plans.d.ts.map