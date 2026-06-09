import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  listSessions,
  listChats,
  getSession,
  createSession,
  archiveSession,
  unarchiveSession,
} from "../api/sessions";
import type {
  ListSessionsParams,
  ListChatsParams,
  CreateSessionInput,
} from "../api/sessions";

export function useSessionsQuery(params?: ListSessionsParams) {
  return useQuery({
    queryKey: ["sessions", "list", params],
    queryFn: () => listSessions(params),
  });
}

export function useChatsQuery(params?: ListChatsParams) {
  return useQuery({
    queryKey: ["sessions", "chats", params],
    queryFn: () => listChats(params),
  });
}

export function useSessionQuery(sessionId: string, workspaceId = "default") {
  return useQuery({
    queryKey: ["sessions", "detail", sessionId, workspaceId],
    queryFn: () => getSession(sessionId, workspaceId),
    enabled: !!sessionId,
  });
}

export function useCreateSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSessionInput) => createSession(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useArchiveSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => archiveSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useUnarchiveSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => unarchiveSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
