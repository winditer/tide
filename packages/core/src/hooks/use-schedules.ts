import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchSchedules,
  fetchSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
  triggerSchedule,
  fetchScheduleRuns,
} from "../api/schedules";
import type { CreateScheduleInput, UpdateScheduleInput } from "../types/schedule";

export function useSchedulesQuery() {
  return useQuery({
    queryKey: ["schedules"],
    queryFn: () => fetchSchedules(),
  });
}

export function useScheduleQuery(id: string) {
  return useQuery({
    queryKey: ["schedule", id],
    queryFn: () => fetchSchedule(id),
    enabled: !!id,
  });
}

export function useCreateScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateScheduleInput) => createSchedule(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
  });
}

export function useUpdateScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateScheduleInput }) =>
      updateSchedule(id, params),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      queryClient.invalidateQueries({ queryKey: ["schedule", id] });
    },
  });
}

export function useDeleteScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
  });
}

export function useToggleScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => toggleSchedule(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      queryClient.invalidateQueries({ queryKey: ["schedule", id] });
    },
  });
}

export function useTriggerScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => triggerSchedule(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      queryClient.invalidateQueries({ queryKey: ["schedule", id] });
      queryClient.invalidateQueries({ queryKey: ["schedule-runs", id] });
    },
  });
}

export function useScheduleRunsQuery(id: string) {
  return useQuery({
    queryKey: ["schedule-runs", id],
    queryFn: () => fetchScheduleRuns(id),
    enabled: !!id,
  });
}
