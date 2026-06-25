import { apiClient } from "./client";
export function getProject(projectId) {
    return apiClient.get(`/api/projects/${encodeURIComponent(projectId)}`);
}
export function getProjectSessions(projectId, agent_id) {
    const qs = agent_id ? `?agent_id=${encodeURIComponent(agent_id)}` : "";
    return apiClient.get(`/api/projects/${encodeURIComponent(projectId)}/sessions${qs}`);
}
export function getProjectChats(projectId, agent_id) {
    const qs = agent_id ? `?agent_id=${encodeURIComponent(agent_id)}` : "";
    return apiClient.get(`/api/projects/${encodeURIComponent(projectId)}/chats${qs}`);
}
export function getProjectTasks(projectId) {
    return apiClient.get(`/api/projects/${encodeURIComponent(projectId)}/tasks`);
}
export function createProject(body) {
    return apiClient.post("/api/projects", body);
}
export function getProjectRoots() {
    return apiClient.get("/api/projects/roots");
}
export function deleteProject(projectId) {
    return apiClient.del(`/api/projects/${encodeURIComponent(projectId)}`);
}
export function archiveProject(projectId) {
    return apiClient.post(`/api/projects/${encodeURIComponent(projectId)}/archive`, {});
}
export function unarchiveProject(projectId) {
    return apiClient.post(`/api/projects/${encodeURIComponent(projectId)}/unarchive`, {});
}
/**
 * URL-safe base64 编码（不带 ``=`` padding）
 * 用于在客户端把 cwd 转成 project_id（与后端 ``_encode_id`` 保持一致）。
 */
export function encodeProjectId(cwd) {
    if (typeof window === "undefined") {
        return Buffer.from(cwd, "utf-8")
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }
    const utf8 = new TextEncoder().encode(cwd);
    let bin = "";
    utf8.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
//# sourceMappingURL=projects.js.map