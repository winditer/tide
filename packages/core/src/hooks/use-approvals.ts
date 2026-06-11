import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchApprovals,
  getApproval,
  approveApproval,
  rejectApproval,
  type ListApprovalsParams,
} from "../api/approvals";

export function useApprovals(params?: ListApprovalsParams) {
  return useQuery({
    queryKey: ["approvals", params ?? {}],
    queryFn: () => fetchApprovals(params),
  });
}

export function useApproval(id: string | undefined) {
  return useQuery({
    queryKey: ["approvals", "detail", id],
    queryFn: () => getApproval(id!),
    enabled: !!id,
  });
}

/** 审批操作成功后批量失效相关查询。 */
function invalidateApprovalRelated(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["approvals"] });
  qc.invalidateQueries({ queryKey: ["work-items"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
}

export function useApproveApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      operatorId,
      comment,
    }: {
      id: string;
      operatorId?: string;
      comment?: string;
    }) => approveApproval(id, operatorId, comment),
    onSuccess: () => invalidateApprovalRelated(qc),
  });
}

export function useRejectApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      operatorId,
      comment,
    }: {
      id: string;
      operatorId?: string;
      comment?: string;
    }) => rejectApproval(id, operatorId, comment),
    onSuccess: () => invalidateApprovalRelated(qc),
  });
}
