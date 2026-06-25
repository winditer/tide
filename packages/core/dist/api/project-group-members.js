import { apiClient } from "./client";
export function listGroupUserMembers(groupId) {
    return apiClient.get(`/api/project-groups/${encodeURIComponent(groupId)}/users`);
}
export function addGroupUserMember(groupId, body) {
    return apiClient.post(`/api/project-groups/${encodeURIComponent(groupId)}/users`, body);
}
export function updateGroupUserMember(groupId, userId, body) {
    return apiClient.put(`/api/project-groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`, body);
}
export function removeGroupUserMember(groupId, userId) {
    return apiClient.del(`/api/project-groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`);
}
//# sourceMappingURL=project-group-members.js.map