import { useQuery, useMutation, useQueryClient, } from "@tanstack/react-query";
import { getPlans, getPlan, getPlanDAG, getPlanTasks, getPlanTimeline, createPlan, stopPlan, retryPlanTask, } from "../api/plans";
export function usePlans(params) {
    return useQuery({
        queryKey: ["plans", params],
        queryFn: () => getPlans(params),
    });
}
export function usePlan(id) {
    return useQuery({
        queryKey: ["plan", id],
        queryFn: () => getPlan(id),
        enabled: !!id,
    });
}
export function usePlanDAG(id, options) {
    return useQuery({
        queryKey: ["plan-dag", id],
        queryFn: () => getPlanDAG(id),
        enabled: !!id,
        refetchInterval: options === null || options === void 0 ? void 0 : options.refetchInterval,
    });
}
export function usePlanTasks(id, options) {
    return useQuery({
        queryKey: ["plan-tasks", id],
        queryFn: () => getPlanTasks(id),
        enabled: !!id,
        refetchInterval: options === null || options === void 0 ? void 0 : options.refetchInterval,
    });
}
export function usePlanTimeline(id, options) {
    return useQuery({
        queryKey: ["plan-timeline", id],
        queryFn: () => getPlanTimeline(id),
        enabled: !!id,
        refetchInterval: options === null || options === void 0 ? void 0 : options.refetchInterval,
    });
}
export function useCreatePlan() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (params) => createPlan(params),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["plans"] });
        },
    });
}
export function useStopPlan() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => stopPlan(id),
        onSuccess: (_data, id) => {
            qc.invalidateQueries({ queryKey: ["plans"] });
            qc.invalidateQueries({ queryKey: ["plan", id] });
            qc.invalidateQueries({ queryKey: ["plan-dag", id] });
            qc.invalidateQueries({ queryKey: ["plan-tasks", id] });
            qc.invalidateQueries({ queryKey: ["plan-timeline", id] });
        },
    });
}
export function useRetryPlanTask(planId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (taskId) => retryPlanTask(planId, taskId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["plan", planId] });
            qc.invalidateQueries({ queryKey: ["plan-dag", planId] });
            qc.invalidateQueries({ queryKey: ["plan-tasks", planId] });
            qc.invalidateQueries({ queryKey: ["plan-timeline", planId] });
        },
    });
}
//# sourceMappingURL=use-plans.js.map