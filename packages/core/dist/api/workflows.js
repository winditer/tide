import { apiClient } from "./client";
export function fetchWorkflows() {
    return apiClient.get("/api/workflows");
}
export function fetchWorkflow(id) {
    return apiClient.get(`/api/workflows/${id}`);
}
export function createWorkflow(params) {
    return apiClient.post("/api/workflows", params);
}
export function updateWorkflow(id, params) {
    return apiClient.put(`/api/workflows/${id}`, params);
}
export function deleteWorkflow(id) {
    return apiClient.del(`/api/workflows/${id}`);
}
export function toggleWorkflow(id) {
    return apiClient.patch(`/api/workflows/${id}/toggle`);
}
export function runWorkflow(id, body) {
    return apiClient.post(`/api/workflows/${id}/run`, body !== null && body !== void 0 ? body : {});
}
export function fetchWorkflowRuns(id) {
    return apiClient.get(`/api/workflows/${id}/runs`);
}
export function fetchWorkflowRun(id, runId) {
    return apiClient.get(`/api/workflows/${id}/runs/${runId}`);
}
export function cancelRun(id, runId) {
    return apiClient.post(`/api/workflows/${id}/runs/${runId}/cancel`);
}
export function approveNode(id, runId, nodeId) {
    return apiClient.post(`/api/workflows/${id}/runs/${runId}/nodes/${nodeId}/approve`);
}
export function rejectNode(id, runId, nodeId) {
    return apiClient.post(`/api/workflows/${id}/runs/${runId}/nodes/${nodeId}/reject`);
}
//# sourceMappingURL=workflows.js.map