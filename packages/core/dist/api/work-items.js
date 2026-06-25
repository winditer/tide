import { apiClient } from "./client";
function buildQuery(params) {
    if (!params)
        return "";
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            search.set(key, value);
        }
    }
    const qs = search.toString();
    return qs ? `?${qs}` : "";
}
export function getWorkItems(projectId, filters) {
    const qs = buildQuery({
        project_id: projectId,
        search: filters === null || filters === void 0 ? void 0 : filters.search,
        status: filters === null || filters === void 0 ? void 0 : filters.status,
        assignee: filters === null || filters === void 0 ? void 0 : filters.assignee,
        version_id: filters === null || filters === void 0 ? void 0 : filters.version_id,
        group_id: filters === null || filters === void 0 ? void 0 : filters.group_id,
    });
    return apiClient.get(`/api/work-items${qs}`);
}
export function getWorkItem(id) {
    return apiClient.get(`/api/work-items/${id}`);
}
export function createWorkItem(data) {
    return apiClient.post("/api/work-items", data);
}
export function updateWorkItem(id, data) {
    return apiClient.patch(`/api/work-items/${id}`, data);
}
export function deleteWorkItem(id) {
    return apiClient.del(`/api/work-items/${id}`);
}
// ---------- 流转 ----------
export function transitionWorkItem(id, targetNodeId, operator) {
    return apiClient.post(`/api/work-items/${id}/transition`, { target_node_id: targetNodeId, operator });
}
export function getWorkItemTransitions(id) {
    return apiClient.get(`/api/work-items/${id}/transitions`);
}
// ---------- 跨仓库执行结果聚合 ----------
export function getWorkItemCrossRepoResults(id) {
    return apiClient.get(`/api/work-items/${id}/cross-repo-results`);
}
// ---------- 看板 ----------
export function getWorkItemBoard(projectId, versionId) {
    const qs = buildQuery({ project_id: projectId, version_id: versionId });
    return apiClient.get(`/api/kanban/work-items${qs}`);
}
export function moveWorkItem(id, targetNodeId) {
    return apiClient.post(`/api/kanban/work-items/${id}/move`, { target_node_id: targetNodeId });
}
// ---------- 项目-工作流绑定 ----------
export function getProjectWorkflow(projectId) {
    return apiClient.get(`/api/projects/${encodeURIComponent(projectId)}/workflow`);
}
export function bindProjectWorkflow(projectId, workflowId) {
    return apiClient.put(`/api/projects/${encodeURIComponent(projectId)}/workflow`, { workflow_id: workflowId });
}
export function unbindProjectWorkflow(projectId) {
    return apiClient.del(`/api/projects/${encodeURIComponent(projectId)}/workflow`);
}
// ---------- 产物 (Artifacts) ----------
export function addArtifact(workItemId, data) {
    return apiClient.post(`/api/work-items/${workItemId}/artifacts`, data);
}
export function removeArtifact(workItemId, artifactId) {
    return apiClient.del(`/api/work-items/${workItemId}/artifacts/${artifactId}`);
}
//# sourceMappingURL=work-items.js.map