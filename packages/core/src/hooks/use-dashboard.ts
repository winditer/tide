import { useQuery } from "@tanstack/react-query";
import {
  getDashboardStats,
  getRecentTasks,
  getAgents,
  getProjects,
  getSessions,
} from "../api/dashboard";
import type { GetSessionsParams } from "../api/dashboard";

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

export function useProjects(params?: { show_archived?: boolean }) {
  return useQuery({
    queryKey: ["projects", params],
    queryFn: () => getProjects(params),
  });
}

export function useSessions(params?: GetSessionsParams) {
  return useQuery({
    queryKey: ["sessions", params],
    queryFn: () => getSessions(params),
  });
}
