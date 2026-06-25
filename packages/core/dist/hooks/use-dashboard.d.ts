import type { GetSessionsParams } from "../api/dashboard";
export declare function useDashboardStats(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").DashboardStats>, Error>;
export declare function useRecentTasks(limit?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").RecentTasksResponse>, Error>;
export declare function useAgents(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").AgentsResponse>, Error>;
export declare function useProjects(params?: {
    show_archived?: boolean;
}): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectsResponse>, Error>;
export declare function useSessions(params?: GetSessionsParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").SessionsResponse>, Error>;
export declare function useActiveProjects(limit?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ActiveProject[]>, Error>;
export declare function useActivityTimeline(limit?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ActivityEvent[]>, Error>;
export declare function useTaskStatusDistribution(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").TaskStatusDistribution>, Error>;
export declare function useUpcomingSchedules(limit?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").UpcomingSchedule[]>, Error>;
export declare function useMyWorkItems(limit?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").MyWorkItem[]>, Error>;
export declare function useProjectProgress(limit?: number, groupId?: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectProgress[]>, Error>;
export declare function useGroupProgress(limit?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectGroupProgress[]>, Error>;
//# sourceMappingURL=use-dashboard.d.ts.map