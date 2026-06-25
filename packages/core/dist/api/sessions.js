import { apiClient } from "./client";
function buildQuery(params) {
    if (!params)
        return "";
    const search = new URLSearchParams();
    if (params.workspace_id)
        search.set("workspace_id", params.workspace_id);
    if (params.project)
        search.set("project", params.project);
    if (params.group_id)
        search.set("group_id", params.group_id);
    if (params.agent_id)
        search.set("agent_id", params.agent_id);
    if (params.type && params.type !== "all")
        search.set("type", params.type);
    if (params.page)
        search.set("page", String(params.page));
    if (params.page_size)
        search.set("page_size", String(params.page_size));
    if (params.show_archived !== undefined)
        search.set("show_archived", params.show_archived ? "true" : "false");
    const q = search.toString();
    return q ? `?${q}` : "";
}
function buildChatsQuery(params) {
    if (!params)
        return "";
    const search = new URLSearchParams();
    if (params.agent_id)
        search.set("agent_id", params.agent_id);
    if (params.page)
        search.set("page", String(params.page));
    if (params.page_size)
        search.set("page_size", String(params.page_size));
    if (params.show_archived !== undefined)
        search.set("show_archived", params.show_archived ? "true" : "false");
    const q = search.toString();
    return q ? `?${q}` : "";
}
export function listSessions(params) {
    return apiClient.get(`/api/sessions${buildQuery(params)}`);
}
/** 获取普通对话（非项目会话）列表，调用 GET /api/sessions/chats */
export function listChats(params) {
    return apiClient.get(`/api/sessions/chats${buildChatsQuery(params)}`);
}
export function getSession(sessionId, workspaceId = "default") {
    const q = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
    return apiClient.get(`/api/sessions/${encodeURIComponent(sessionId)}${q}`);
}
export function createSession(body) {
    return apiClient.post("/api/sessions", body);
}
export function fetchSessionsForProject(cwd) {
    const q = `?cwd=${encodeURIComponent(cwd)}`;
    return apiClient.get(`/api/sessions/list-for-project${q}`);
}
export function archiveSession(sessionId) {
    return apiClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {});
}
export function unarchiveSession(sessionId) {
    return apiClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/unarchive`, {});
}
//# sourceMappingURL=sessions.js.map