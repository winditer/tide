import { apiClient } from "./client";
export function listProjectMembers(projectId) {
    return apiClient.get(`/api/projects/${encodeURIComponent(projectId)}/members`);
}
export function addProjectMember(projectId, body) {
    return apiClient.post(`/api/projects/${encodeURIComponent(projectId)}/members`, body);
}
export function updateProjectMemberRole(projectId, userId, body) {
    return apiClient.put(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, body);
}
export function removeProjectMember(projectId, userId) {
    return apiClient.del(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`);
}
//# sourceMappingURL=project-members.js.map