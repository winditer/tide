import { type ListApprovalsParams } from "../api/approvals";
export declare function useApprovals(params?: ListApprovalsParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListApprovalsResponse>, Error>;
export declare function useApproval(id: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").Approval>, Error>;
export declare function useApproveApproval(): import("@tanstack/react-query").UseMutationResult<import("..").ApprovalActionResponse, Error, {
    id: string;
    operatorId?: string;
    comment?: string;
}, unknown>;
export declare function useRejectApproval(): import("@tanstack/react-query").UseMutationResult<import("..").ApprovalActionResponse, Error, {
    id: string;
    operatorId?: string;
    comment?: string;
}, unknown>;
//# sourceMappingURL=use-approvals.d.ts.map