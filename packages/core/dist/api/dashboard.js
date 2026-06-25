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
export function getProjects(params) {
    const search = new URLSearchParams();
    if ((params === null || params === void 0 ? void 0 : params.show_archived) !== undefined)
        search.set("show_archived", params.show_archived ? "true" : "false");
    const q = search.toString();
    return apiClient.get(`/api/projects${q ? `?${q}` : ""}`);
}
export function getSessions(params) {
    const searchParams = new URLSearchParams();
    if (params === null || params === void 0 ? void 0 : params.project)
        searchParams.set("project", params.project);
    if (params === null || params === void 0 ? void 0 : params.group_id)
        searchParams.set("group_id", params.group_id);
    if (params === null || params === void 0 ? void 0 : params.agent_id)
        searchParams.set("agent_id", params.agent_id);
    if (params === null || params === void 0 ? void 0 : params.page)
        searchParams.set("page", String(params.page));
    if (params === null || params === void 0 ? void 0 : params.page_size)
        searchParams.set("page_size", String(params.page_size));
    if ((params === null || params === void 0 ? void 0 : params.show_archived) !== undefined)
        searchParams.set("show_archived", params.show_archived ? "true" : "false");
    const query = searchParams.toString();
    return apiClient.get(`/api/sessions${query ? `?${query}` : ""}`);
}
export function fetchActiveProjects(limit = 5) {
    return apiClient.get(`/api/dashboard/active-projects?limit=${limit}`);
}
export function fetchActivityTimeline(limit = 15) {
    return apiClient.get(`/api/dashboard/activity-timeline?limit=${limit}`);
}
export function fetchTaskStatusDistribution() {
    return apiClient.get(`/api/dashboard/task-status-distribution`);
}
export function fetchUpcomingSchedules(limit = 5) {
    return apiClient.get(`/api/dashboard/upcoming-schedules?limit=${limit}`);
}
export function getMyWorkItems(limit = 10) {
    return apiClient.get(`/api/dashboard/work-items?limit=${limit}`);
}
export function getProjectProgress(limit = 8, groupId) {
    const search = new URLSearchParams();
    search.set("limit", String(limit));
    if (groupId)
        search.set("group_id", groupId);
    return apiClient.get(`/api/dashboard/project-progress?${search.toString()}`);
}
export function getGroupProgress(limit = 8) {
    return apiClient.get(`/api/dashboard/group-progress?limit=${limit}`);
}
//# sourceMappingURL=dashboard.js.map