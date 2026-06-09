import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  listTasks,
  getTask,
  createTask,
  stopTask,
  approveTask,
  rejectTask,
  retryTask,
} from "../api/tasks";
import type { CreateTaskParams, ListTasksParams, ApprovalAction } from "../api/tasks";

export function useTasksQuery(params?: ListTasksParams) {
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: () => listTasks(params),
  });
}

export function useTaskQuery(id: string) {
  return useQuery({
    queryKey: ["task", id],
    queryFn: () => getTask(id),
    enabled: !!id,
  });
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateTaskParams) => createTask(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useStopTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stopTask(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", id] });
    },
  });
}

export function useApproveTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveTask(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", id] });
    },
  });
}

export function useRejectTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: ApprovalAction }) =>
      rejectTask(id, body),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", id] });
    },
  });
}

export function useRetryTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryTask(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", id] });
    },
  });
}
