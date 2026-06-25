import { useQuery, useMutation, useQueryClient, } from "@tanstack/react-query";
import { fetchApprovals, getApproval, approveApproval, rejectApproval, } from "../api/approvals";
export function useApprovals(params) {
    return useQuery({
        queryKey: ["approvals", params !== null && params !== void 0 ? params : {}],
        queryFn: () => fetchApprovals(params),
    });
}
export function useApproval(id) {
    return useQuery({
        queryKey: ["approvals", "detail", id],
        queryFn: () => getApproval(id),
        enabled: !!id,
    });
}
/** 审批操作成功后批量失效相关查询。 */
function invalidateApprovalRelated(qc) {
    qc.invalidateQueries({ queryKey: ["approvals"] });
    qc.invalidateQueries({ queryKey: ["work-items"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
}
export function useApproveApproval() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, operatorId, comment, }) => approveApproval(id, operatorId, comment),
        onSuccess: () => invalidateApprovalRelated(qc),
    });
}
export function useRejectApproval() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, operatorId, comment, }) => rejectApproval(id, operatorId, comment),
        onSuccess: () => invalidateApprovalRelated(qc),
    });
}
//# sourceMappingURL=use-approvals.js.map