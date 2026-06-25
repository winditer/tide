import { apiClient } from "./client";
function buildQuery(params) {
    if (!params)
        return "";
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            search.set(key, String(value));
        }
    }
    const qs = search.toString();
    return qs ? `?${qs}` : "";
}
export function listProjectGroups(workspaceId) {
    const qs = buildQuery({ workspace_id: workspaceId });
    return apiClient.get(`/api/project-groups${qs}`);
}
export function getProjectGroup(groupId) {
    return apiClient.get(`/api/project-groups/${encodeURIComponent(groupId)}`);
}
export function createProjectGroup(body) {
    return apiClient.post("/api/project-groups", body);
}
export function updateProjectGroup(groupId, body) {
    return apiClient.put(`/api/project-groups/${encodeURIComponent(groupId)}`, body);
}
export function deleteProjectGroup(groupId) {
    return apiClient.del(`/api/project-groups/${encodeURIComponent(groupId)}`);
}
export function addGroupMember(groupId, body) {
    return apiClient.post(`/api/project-groups/${encodeURIComponent(groupId)}/members`, body);
}
export function removeGroupMember(groupId, projectId) {
    return apiClient.del(`/api/project-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(projectId)}`);
}
// ── 聚合查询 ───────────────────────────────────────────────────────────────
/** 拉取项目组聚合的会话列表（按 session_id 去重，按最后活跃时间倒序）。 */
export function getGroupConversations(groupId, params) {
    const qs = buildQuery({
        limit: params === null || params === void 0 ? void 0 : params.limit,
        offset: params === null || params === void 0 ? void 0 : params.offset,
    });
    return apiClient.get(`/api/project-groups/${encodeURIComponent(groupId)}/conversations${qs}`);
}
/** 拉取项目组聚合的任务列表。 */
export function getGroupTasks(groupId, params) {
    const qs = buildQuery({
        status: params === null || params === void 0 ? void 0 : params.status,
        limit: params === null || params === void 0 ? void 0 : params.limit,
        offset: params === null || params === void 0 ? void 0 : params.offset,
    });
    return apiClient.get(`/api/project-groups/${encodeURIComponent(groupId)}/tasks${qs}`);
}
/** 拉取项目组聚合的版本列表（跨成员项目）。 */
export function getGroupVersions(groupId, params) {
    const qs = buildQuery({
        limit: params === null || params === void 0 ? void 0 : params.limit,
        offset: params === null || params === void 0 ? void 0 : params.offset,
    });
    return apiClient.get(`/api/project-groups/${encodeURIComponent(groupId)}/versions${qs}`);
}
// ── 工作流绑定 ────────────────────────────────────────────────────────────
export function getGroupWorkflow(groupId) {
    return apiClient.get(`/api/project-groups/${encodeURIComponent(groupId)}/workflow`);
}
export function setGroupWorkflow(groupId, workflowId) {
    return apiClient.put(`/api/project-groups/${encodeURIComponent(groupId)}/workflow`, { workflow_id: workflowId });
}
export function deleteGroupWorkflow(groupId) {
    return apiClient.del(`/api/project-groups/${encodeURIComponent(groupId)}/workflow`);
}
//# sourceMappingURL=project-groups.js.map