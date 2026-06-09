import { useQuery, useMutation, useQueryClient, } from "@tanstack/react-query";
import { fetchSchedules, fetchSchedule, createSchedule, updateSchedule, deleteSchedule, toggleSchedule, triggerSchedule, fetchScheduleRuns, } from "../api/schedules";
export function useSchedulesQuery() {
    return useQuery({
        queryKey: ["schedules"],
        queryFn: () => fetchSchedules(),
    });
}
export function useScheduleQuery(id) {
    return useQuery({
        queryKey: ["schedule", id],
        queryFn: () => fetchSchedule(id),
        enabled: !!id,
    });
}
export function useCreateScheduleMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params) => createSchedule(params),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["schedules"] });
        },
    });
}
export function useUpdateScheduleMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, params }) => updateSchedule(id, params),
        onSuccess: (_data, { id }) => {
            queryClient.invalidateQueries({ queryKey: ["schedules"] });
            queryClient.invalidateQueries({ queryKey: ["schedule", id] });
        },
    });
}
export function useDeleteScheduleMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => deleteSchedule(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["schedules"] });
        },
    });
}
export function useToggleScheduleMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => toggleSchedule(id),
        onSuccess: (_data, id) => {
            queryClient.invalidateQueries({ queryKey: ["schedules"] });
            queryClient.invalidateQueries({ queryKey: ["schedule", id] });
        },
    });
}
export function useTriggerScheduleMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => triggerSchedule(id),
        onSuccess: (_data, id) => {
            queryClient.invalidateQueries({ queryKey: ["schedules"] });
            queryClient.invalidateQueries({ queryKey: ["schedule", id] });
            queryClient.invalidateQueries({ queryKey: ["schedule-runs", id] });
        },
    });
}
export function useScheduleRunsQuery(id) {
    return useQuery({
        queryKey: ["schedule-runs", id],
        queryFn: () => fetchScheduleRuns(id),
        enabled: !!id,
    });
}
//# sourceMappingURL=use-schedules.js.map