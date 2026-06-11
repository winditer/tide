import { apiClient } from "./client";

/**
 * 审批记录类型。
 *
 * 后端 `detail` 字段在数据库中以 JSON 字符串形式存储，
 * 接口返回时未做反序列化，因此前端类型为 `string | Record<string, any>`。
 * 使用时请通过 {@link parseApprovalDetail} 进行规范化处理。
 */
export interface Approval {
  id: string;
  task_id: string | null;
  plan_id: string | null;
  workspace_id: string | null;
  chat_id: string | null;
  type: string;
  detail: string | Record<string, any> | null;
  status: "pending" | "approved" | "rejected";
  operator_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ListApprovalsParams {
  workspace_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ListApprovalsResponse {
  items: Approval[];
  total: number;
}

export interface ApprovalActionResponse {
  ok: boolean;
  approval_id: string;
  status: "approved" | "rejected";
}

/** 解析 approval.detail，统一返回对象。 */
export function parseApprovalDetail(
  approval: Pick<Approval, "detail"> | null | undefined
): Record<string, any> {
  if (!approval) return {};
  const raw = approval.detail;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, any>;
    } catch {
      return {};
    }
  }
  return raw;
}

export function fetchApprovals(
  params?: ListApprovalsParams
): Promise<ListApprovalsResponse> {
  const search = new URLSearchParams();
  if (params?.workspace_id) search.set("workspace_id", params.workspace_id);
  if (params?.status) search.set("status", params.status);
  if (params?.limit !== undefined) search.set("limit", String(params.limit));
  if (params?.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return apiClient.get<ListApprovalsResponse>(
    `/api/approvals${qs ? `?${qs}` : ""}`
  );
}

export function getApproval(id: string): Promise<Approval> {
  return apiClient.get<Approval>(`/api/approvals/${id}`);
}

export function approveApproval(
  id: string,
  operatorId?: string
): Promise<ApprovalActionResponse> {
  const qs = operatorId
    ? `?operator_id=${encodeURIComponent(operatorId)}`
    : "";
  return apiClient.post<ApprovalActionResponse>(
    `/api/approvals/${id}/approve${qs}`
  );
}

export function rejectApproval(
  id: string,
  operatorId?: string
): Promise<ApprovalActionResponse> {
  const qs = operatorId
    ? `?operator_id=${encodeURIComponent(operatorId)}`
    : "";
  return apiClient.post<ApprovalActionResponse>(
    `/api/approvals/${id}/reject${qs}`
  );
}
