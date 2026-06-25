import { type CreateProjectInput } from "../api/projects";
export declare function useProject(projectId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectDetail>, Error>;
export declare function useProjectSessions(projectId: string | undefined, agentId?: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectSessionsResponse>, Error>;
export declare function useProjectChats(projectId: string | undefined, agentId?: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectChatsResponse>, Error>;
export declare function useProjectTasks(projectId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectTasksResponse>, Error>;
export declare function useCreateProject(): import("@tanstack/react-query").UseMutationResult<import("..").ProjectDetail, Error, CreateProjectInput, unknown>;
export declare function useProjectRoots(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectRootsResponse>, Error>;
export declare function useDeleteProject(): import("@tanstack/react-query").UseMutationResult<{
    removed: boolean;
    cwd: string;
}, Error, string, unknown>;
export declare function useArchiveProject(): import("@tanstack/react-query").UseMutationResult<import("..").ArchiveProjectResult, Error, string, unknown>;
export declare function useUnarchiveProject(): import("@tanstack/react-query").UseMutationResult<import("..").ArchiveProjectResult, Error, string, unknown>;
//# sourceMappingURL=use-projects.d.ts.map