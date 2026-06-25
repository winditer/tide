import type { ListSessionsParams, ListChatsParams, CreateSessionInput } from "../api/sessions";
export declare function useSessionsQuery(params?: ListSessionsParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").SessionsResponse>, Error>;
export declare function useChatsQuery(params?: ListChatsParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").SessionsResponse>, Error>;
export declare function useSessionQuery(sessionId: string, workspaceId?: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").SessionDetail>, Error>;
export declare function useCreateSessionMutation(): import("@tanstack/react-query").UseMutationResult<import("..").CreateSessionResult, Error, CreateSessionInput, unknown>;
export declare function useArchiveSessionMutation(): import("@tanstack/react-query").UseMutationResult<import("..").ArchiveSessionResult, Error, string, unknown>;
export declare function useUnarchiveSessionMutation(): import("@tanstack/react-query").UseMutationResult<import("..").ArchiveSessionResult, Error, string, unknown>;
//# sourceMappingURL=use-sessions.d.ts.map