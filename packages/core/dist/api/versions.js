import { apiClient } from "./client";
function buildQuery(params) {
    if (!params)
        return "";
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") {
            search.set(k, v);
        }
    }
    const qs = search.toString();
    return qs ? `?${qs}` : "";
}
export function getVersions(projectId) {
    return apiClient.get(`/api/versions${buildQuery({ project_id: projectId })}`);
}
export function createVersion(data) {
    return apiClient.post("/api/versions", data);
}
export function updateVersion(id, data) {
    return apiClient.patch(`/api/versions/${id}`, data);
}
export function deleteVersion(id) {
    return apiClient.del(`/api/versions/${id}`);
}
//# sourceMappingURL=versions.js.map