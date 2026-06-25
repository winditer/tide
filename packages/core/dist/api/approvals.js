import { apiClient } from "./client";
/** 解析 approval.detail，统一返回对象。 */
export function parseApprovalDetail(approval) {
    if (!approval)
        return {};
    const raw = approval.detail;
    if (!raw)
        return {};
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw);
        }
        catch (_a) {
            return {};
        }
    }
    return raw;
}
export function fetchApprovals(params) {
    const search = new URLSearchParams();
    if (params === null || params === void 0 ? void 0 : params.workspace_id)
        search.set("workspace_id", params.workspace_id);
    if (params === null || params === void 0 ? void 0 : params.status)
        search.set("status", params.status);
    if ((params === null || params === void 0 ? void 0 : params.limit) !== undefined)
        search.set("limit", String(params.limit));
    if ((params === null || params === void 0 ? void 0 : params.offset) !== undefined)
        search.set("offset", String(params.offset));
    const qs = search.toString();
    return apiClient.get(`/api/approvals${qs ? `?${qs}` : ""}`);
}
export function getApproval(id) {
    return apiClient.get(`/api/approvals/${id}`);
}
export function approveApproval(id, operatorId, comment) {
    const qs = operatorId
        ? `?operator_id=${encodeURIComponent(operatorId)}`
        : "";
    const body = {};
    if (operatorId)
        body.operator_id = operatorId;
    if (comment !== undefined && comment !== null)
        body.comment = comment;
    return apiClient.post(`/api/approvals/${id}/approve${qs}`, Object.keys(body).length > 0 ? body : undefined);
}
export function rejectApproval(id, operatorId, comment) {
    const qs = operatorId
        ? `?operator_id=${encodeURIComponent(operatorId)}`
        : "";
    const body = {};
    if (operatorId)
        body.operator_id = operatorId;
    if (comment !== undefined && comment !== null)
        body.comment = comment;
    return apiClient.post(`/api/approvals/${id}/reject${qs}`, Object.keys(body).length > 0 ? body : undefined);
}
//# sourceMappingURL=approvals.js.map