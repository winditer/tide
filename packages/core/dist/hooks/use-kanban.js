import { useQuery, useMutation, useQueryClient, } from "@tanstack/react-query";
import { fetchProjectBoard, fetchSessionBoard, fetchAgentBoard, fetchWorkflowBoard, moveCard, } from "../api/kanban";
export function useProjectBoard(params) {
    return useQuery({
        queryKey: ["kanban", "projects", params],
        queryFn: () => fetchProjectBoard(params),
    });
}
export function useSessionBoard(params) {
    return useQuery({
        queryKey: ["kanban", "sessions", params],
        queryFn: () => fetchSessionBoard(params),
    });
}
export function useAgentBoard(params) {
    return useQuery({
        queryKey: ["kanban", "agents", params],
        queryFn: () => fetchAgentBoard(params),
    });
}
export function useWorkflowBoard(params) {
    return useQuery({
        queryKey: ["kanban", "workflows", params],
        queryFn: () => fetchWorkflowBoard(params),
    });
}
export function useMoveCard() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input) => moveCard(input),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["kanban"] });
        },
    });
}
//# sourceMappingURL=use-kanban.js.map