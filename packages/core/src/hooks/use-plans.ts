import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getPlans,
  getPlan,
  getPlanDAG,
  getPlanTasks,
  getPlanTimeline,
  createPlan,
  stopPlan,
  retryPlanTask,
} from "../api/plans";
import type { ListPlansParams, CreatePlanParams } from "../api/plans";

export function usePlans(params?: ListPlansParams) {
  return useQuery({
    queryKey: ["plans", params],
    queryFn: () => getPlans(params),
  });
}

export function usePlan(id: string) {
  return useQuery({
    queryKey: ["plan", id],
    queryFn: () => getPlan(id),
    enabled: !!id,
  });
}

export function usePlanDAG(id: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["plan-dag", id],
    queryFn: () => getPlanDAG(id),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
  });
}

export function usePlanTasks(id: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["plan-tasks", id],
    queryFn: () => getPlanTasks(id),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
  });
}

export function usePlanTimeline(id: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["plan-timeline", id],
    queryFn: () => getPlanTimeline(id),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreatePlanParams) => createPlan(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
    },
  });
}

export function useStopPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stopPlan(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["plan", id] });
      qc.invalidateQueries({ queryKey: ["plan-dag", id] });
      qc.invalidateQueries({ queryKey: ["plan-tasks", id] });
      qc.invalidateQueries({ queryKey: ["plan-timeline", id] });
    },
  });
}

export function useRetryPlanTask(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => retryPlanTask(planId, taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan", planId] });
      qc.invalidateQueries({ queryKey: ["plan-dag", planId] });
      qc.invalidateQueries({ queryKey: ["plan-tasks", planId] });
      qc.invalidateQueries({ queryKey: ["plan-timeline", planId] });
    },
  });
}
