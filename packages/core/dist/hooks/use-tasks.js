import { useQuery, useMutation, useQueryClient, } from "@tanstack/react-query";
import { listTasks, getTask, createTask, stopTask, approveTask, rejectTask, retryTask, } from "../api/tasks";
export function useTasksQuery(params) {
    return useQuery({
        queryKey: ["tasks", params],
        queryFn: () => listTasks(params),
    });
}
export function useTaskQuery(id) {
    return useQuery({
        queryKey: ["task", id],
        queryFn: () => getTask(id),
        enabled: !!id,
    });
}
export function useCreateTaskMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params) => createTask(params),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
        },
    });
}
export function useStopTaskMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => stopTask(id),
        onSuccess: (_data, id) => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            queryClient.invalidateQueries({ queryKey: ["task", id] });
        },
    });
}
export function useApproveTaskMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => approveTask(id),
        onSuccess: (_data, id) => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            queryClient.invalidateQueries({ queryKey: ["task", id] });
        },
    });
}
export function useRejectTaskMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, body }) => rejectTask(id, body),
        onSuccess: (_data, { id }) => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            queryClient.invalidateQueries({ queryKey: ["task", id] });
        },
    });
}
export function useRetryTaskMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id) => retryTask(id),
        onSuccess: (_data, id) => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            queryClient.invalidateQueries({ queryKey: ["task", id] });
        },
    });
}
//# sourceMappingURL=use-tasks.js.map