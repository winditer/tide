import { useQuery, useMutation, useQueryClient, } from "@tanstack/react-query";
import { listSessions, listChats, getSession, createSession, archiveSession, unarchiveSession, } from "../api/sessions";
export function useSessionsQuery(params) {
    return useQuery({
        queryKey: ["sessions", "list", params],
        queryFn: () => listSessions(params),
    });
}
export function useChatsQuery(params) {
    return useQuery({
        queryKey: ["sessions", "chats", params],
        queryFn: () => listChats(params),
    });
}
export function useSessionQuery(sessionId, workspaceId = "default") {
    return useQuery({
        queryKey: ["sessions", "detail", sessionId, workspaceId],
        queryFn: () => getSession(sessionId, workspaceId),
        enabled: !!sessionId,
    });
}
export function useCreateSessionMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => createSession(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["sessions"] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
        },
    });
}
export function useArchiveSessionMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (sessionId) => archiveSession(sessionId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["sessions"] });
        },
    });
}
export function useUnarchiveSessionMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (sessionId) => unarchiveSession(sessionId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["sessions"] });
        },
    });
}
//# sourceMappingURL=use-sessions.js.map