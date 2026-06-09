import { apiClient } from "./client";
export function createTask(params) {
    return apiClient.post("/api/tasks", params);
}
export function listTasks(params) {
    const searchParams = new URLSearchParams();
    if (params === null || params === void 0 ? void 0 : params.workspace_id)
        searchParams.set("workspace_id", params.workspace_id);
    if (params === null || params === void 0 ? void 0 : params.status)
        searchParams.set("status", params.status);
    if (params === null || params === void 0 ? void 0 : params.agent_id)
        searchParams.set("agent_id", params.agent_id);
    if (params === null || params === void 0 ? void 0 : params.page)
        searchParams.set("page", String(params.page));
    if (params === null || params === void 0 ? void 0 : params.page_size)
        searchParams.set("page_size", String(params.page_size));
    const query = searchParams.toString();
    return apiClient.get(`/api/tasks${query ? `?${query}` : ""}`);
}
export function getTask(id) {
    return apiClient.get(`/api/tasks/${id}`);
}
export function stopTask(id) {
    return apiClient.post(`/api/tasks/${id}/stop`);
}
export function approveTask(id) {
    return apiClient.post(`/api/tasks/${id}/approve`);
}
export function rejectTask(id, body) {
    return apiClient.post(`/api/tasks/${id}/reject`, body);
}
export function retryTask(id) {
    return apiClient.post(`/api/tasks/${id}/retry`);
}
//# sourceMappingURL=tasks.js.map