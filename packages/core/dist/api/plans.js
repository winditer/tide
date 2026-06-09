import { apiClient } from "./client";
export function getPlans(params) {
    const search = new URLSearchParams();
    if (params === null || params === void 0 ? void 0 : params.workspace_id)
        search.set("workspace_id", params.workspace_id);
    if (params === null || params === void 0 ? void 0 : params.status)
        search.set("status", params.status);
    if ((params === null || params === void 0 ? void 0 : params.limit) != null)
        search.set("limit", String(params.limit));
    if ((params === null || params === void 0 ? void 0 : params.offset) != null)
        search.set("offset", String(params.offset));
    const q = search.toString();
    return apiClient.get(`/api/plans${q ? `?${q}` : ""}`);
}
export function getPlan(id) {
    return apiClient.get(`/api/plans/${id}`);
}
export function getPlanDAG(id) {
    return apiClient.get(`/api/plans/${id}/dag`);
}
export function getPlanTasks(id) {
    return apiClient.get(`/api/plans/${id}/tasks`);
}
export function getPlanTimeline(id) {
    return apiClient.get(`/api/plans/${id}/timeline`);
}
export function createPlan(params) {
    return apiClient.post("/api/plans", params);
}
export function stopPlan(id) {
    return apiClient.post(`/api/plans/${id}/stop`);
}
export function retryPlanTask(planId, taskId) {
    return apiClient.post(`/api/plans/${planId}/tasks/${taskId}/retry`);
}
//# sourceMappingURL=plans.js.map