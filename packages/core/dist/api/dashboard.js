import { apiClient } from "./client";
export function getDashboardStats() {
    return apiClient.get("/api/dashboard/stats");
}
export function getRecentTasks(limit = 10) {
    return apiClient.get(`/api/dashboard/recent-tasks?limit=${limit}`);
}
export function getAgents() {
    return apiClient.get("/api/agents");
}
export function getProjects() {
    return apiClient.get("/api/projects");
}
export function getSessions() {
    return apiClient.get("/api/sessions");
}
//# sourceMappingURL=dashboard.js.map