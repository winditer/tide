import { useQuery } from "@tanstack/react-query";
import { getDashboardStats, getRecentTasks, getAgents, getProjects, getSessions, } from "../api/dashboard";
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
export function useProjects() {
    return useQuery({
        queryKey: ["projects"],
        queryFn: getProjects,
    });
}
export function useSessions() {
    return useQuery({
        queryKey: ["sessions"],
        queryFn: getSessions,
    });
}
//# sourceMappingURL=use-dashboard.js.map