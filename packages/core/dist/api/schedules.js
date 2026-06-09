import { apiClient } from "./client";
export function fetchSchedules() {
    return apiClient.get("/api/schedules");
}
export function fetchSchedule(id) {
    return apiClient.get(`/api/schedules/${id}`);
}
export function createSchedule(params) {
    return apiClient.post("/api/schedules", params);
}
export function updateSchedule(id, params) {
    return apiClient.put(`/api/schedules/${id}`, params);
}
export function deleteSchedule(id) {
    return apiClient.del(`/api/schedules/${id}`);
}
export function toggleSchedule(id) {
    return apiClient.post(`/api/schedules/${id}/toggle`);
}
export function triggerSchedule(id) {
    return apiClient.post(`/api/schedules/${id}/trigger`);
}
export function fetchScheduleRuns(id) {
    return apiClient.get(`/api/schedules/${id}/runs`);
}
//# sourceMappingURL=schedules.js.map