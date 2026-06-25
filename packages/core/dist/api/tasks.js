import { apiClient } from "./client";
export function createTask(params) {
    return apiClient.post("/api/tasks", params);
}
const BASE_URL = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
    "";
export async function uploadTaskAttachments(files) {
    if (!files.length) {
        return { attachments: [] };
    }
    const formData = new FormData();
    for (const file of files) {
        formData.append("files", file, file.name);
    }
    const response = await fetch(`${BASE_URL}/api/tasks/attachments`, {
        method: "POST",
        body: formData,
    });
    if (!response.ok) {
        let body;
        try {
            body = await response.json();
        }
        catch (_a) {
            body = await response.text();
        }
        throw new Error(`Upload failed (${response.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }
    return response.json();
}
export function listTasks(params) {
    const searchParams = new URLSearchParams();
    if (params === null || params === void 0 ? void 0 : params.workspace_id)
        searchParams.set("workspace_id", params.workspace_id);
    if (params === null || params === void 0 ? void 0 : params.status)
        searchParams.set("status", params.status);
    if (params === null || params === void 0 ? void 0 : params.agent_id)
        searchParams.set("agent_id", params.agent_id);
    if (params === null || params === void 0 ? void 0 : params.project)
        searchParams.set("project", params.project);
    if (params === null || params === void 0 ? void 0 : params.group_id)
        searchParams.set("group_id", params.group_id);
    if (params === null || params === void 0 ? void 0 : params.session_id)
        searchParams.set("session_id", params.session_id);
    if (params === null || params === void 0 ? void 0 : params.created_after)
        searchParams.set("created_after", params.created_after);
    if (params === null || params === void 0 ? void 0 : params.created_before)
        searchParams.set("created_before", params.created_before);
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