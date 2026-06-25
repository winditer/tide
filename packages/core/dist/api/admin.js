import { apiClient } from "./client";
export function listUsers(params = {}) {
    const sp = new URLSearchParams();
    if (params.q)
        sp.set("q", params.q);
    if (params.page)
        sp.set("page", String(params.page));
    if (params.page_size)
        sp.set("page_size", String(params.page_size));
    const qs = sp.toString();
    return apiClient.get(`/api/admin/users${qs ? `?${qs}` : ""}`);
}
export function getAdminUser(userId) {
    return apiClient.get(`/api/admin/users/${encodeURIComponent(userId)}`);
}
export function createAdminUser(body) {
    return apiClient.post("/api/admin/users", body);
}
export function updateAdminUser(userId, body) {
    return apiClient.put(`/api/admin/users/${encodeURIComponent(userId)}`, body);
}
export function deleteAdminUser(userId) {
    return apiClient.del(`/api/admin/users/${encodeURIComponent(userId)}`);
}
export function resetUserPassword(userId, new_password) {
    return apiClient.post(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, { new_password });
}
export function getUserProjects(userId) {
    return apiClient.get(`/api/admin/users/${encodeURIComponent(userId)}/projects`);
}
//# sourceMappingURL=admin.js.map