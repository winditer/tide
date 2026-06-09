import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchProjectBoard,
  fetchSessionBoard,
  fetchAgentBoard,
  fetchWorkflowBoard,
  moveCard,
} from "../api/kanban";
import type { KanbanQueryParams } from "../api/kanban";
import type { MoveCardInput } from "../types/kanban";

export function useProjectBoard(params?: KanbanQueryParams) {
  return useQuery({
    queryKey: ["kanban", "projects", params],
    queryFn: () => fetchProjectBoard(params),
  });
}

export function useSessionBoard(params?: KanbanQueryParams) {
  return useQuery({
    queryKey: ["kanban", "sessions", params],
    queryFn: () => fetchSessionBoard(params),
  });
}

export function useAgentBoard(params?: KanbanQueryParams) {
  return useQuery({
    queryKey: ["kanban", "agents", params],
    queryFn: () => fetchAgentBoard(params),
  });
}

export function useWorkflowBoard(params?: KanbanQueryParams) {
  return useQuery({
    queryKey: ["kanban", "workflows", params],
    queryFn: () => fetchWorkflowBoard(params),
  });
}

export function useMoveCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MoveCardInput) => moveCard(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
}
