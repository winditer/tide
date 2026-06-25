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
export declare function parseApprovalDetail(approval: Pick<Approval, "detail"> | null | undefined): Record<string, any>;
export declare function fetchApprovals(params?: ListApprovalsParams): Promise<ListApprovalsResponse>;
export declare function getApproval(id: string): Promise<Approval>;
export declare function approveApproval(id: string, operatorId?: string, comment?: string): Promise<ApprovalActionResponse>;
export declare function rejectApproval(id: string, operatorId?: string, comment?: string): Promise<ApprovalActionResponse>;
//# sourceMappingURL=approvals.d.ts.map