import { useQuery } from "@tanstack/react-query";
import { getDashboardStats, getRecentTasks, getAgents, getProjects, getSessions, fetchActiveProjects, fetchActivityTimeline, fetchTaskStatusDistribution, fetchUpcomingSchedules, getMyWorkItems, getProjectProgress, getGroupProgress, } from "../api/dashboard";
export function useDashboardStats() {
    return useQuery({
        queryKey: ["dashboard", "stats"],
        queryFn: getDashboardStats,
        refetchInterval: 10000,
    });
}
export function useRecentTasks(limit = 10) {
    return useQuery({
        queryKey: ["dashboard", "recent-tasks", limit],
        queryFn: () => getRecentTasks(limit),
    });
}
export function useAgents() {
    return useQuery({
        queryKey: ["agents"],
        queryFn: getAgents,
    });
}
export function useProjects(params) {
    return useQuery({
        queryKey: ["projects", params],
        queryFn: () => getProjects(params),
    });
}
export function useSessions(params) {
    return useQuery({
        queryKey: ["sessions", params],
        queryFn: () => getSessions(params),
    });
}
export function useActiveProjects(limit = 5) {
    return useQuery({
        queryKey: ["dashboard", "active-projects", limit],
        queryFn: () => fetchActiveProjects(limit),
        refetchInterval: 30000,
    });
}
export function useActivityTimeline(limit = 15) {
    return useQuery({
        queryKey: ["dashboard", "activity-timeline", limit],
        queryFn: () => fetchActivityTimeline(limit),
        refetchInterval: 15000,
    });
}
export function useTaskStatusDistribution() {
    return useQuery({
        queryKey: ["dashboard", "task-status-distribution"],
        queryFn: fetchTaskStatusDistribution,
        refetchInterval: 10000,
    });
}
export function useUpcomingSchedules(limit = 5) {
    return useQuery({
        queryKey: ["dashboard", "upcoming-schedules", limit],
        queryFn: () => fetchUpcomingSchedules(limit),
        refetchInterval: 60000,
    });
}
export function useMyWorkItems(limit = 10) {
    return useQuery({
        queryKey: ["dashboard", "work-items", limit],
        queryFn: () => getMyWorkItems(limit),
        refetchInterval: 30000,
    });
}
export function useProjectProgress(limit = 8, groupId) {
    return useQuery({
        queryKey: ["dashboard", "project-progress", limit, groupId !== null && groupId !== void 0 ? groupId : null],
        queryFn: () => getProjectProgress(limit, groupId),
        refetchInterval: 30000,
    });
}
export function useGroupProgress(limit = 8) {
    return useQuery({
        queryKey: ["dashboard", "group-progress", limit],
        queryFn: () => getGroupProgress(limit),
        refetchInterval: 30000,
    });
}
//# sourceMappingURL=use-dashboard.js.map