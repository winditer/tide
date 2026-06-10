"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@tide/ui";
import { useApproveTaskMutation, useRejectTaskMutation, } from "@tide/core";
export function ApprovalPanel({ taskId, reason }) {
    const approveMutation = useApproveTaskMutation();
    const rejectMutation = useRejectTaskMutation();
    const handleApprove = async () => {
        try {
            await approveMutation.mutateAsync(taskId);
        }
        catch (_a) {
            // handled by mutation state
        }
    };
    const handleReject = async () => {
        try {
            await rejectMutation.mutateAsync({ id: taskId });
        }
        catch (_a) {
            // handled by mutation state
        }
    };
    const isPending = approveMutation.isPending || rejectMutation.isPending;
    return (_jsxs("div", { className: "rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4", children: [_jsx("h4", { className: "mb-2 font-medium text-yellow-600", children: "\u5BA1\u6279\u8BF7\u6C42" }), reason && (_jsx("p", { className: "mb-3 text-sm text-muted-foreground", children: reason })), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { size: "sm", onClick: handleApprove, disabled: isPending, children: approveMutation.isPending ? "批准中..." : "批准" }), _jsx(Button, { size: "sm", variant: "destructive", onClick: handleReject, disabled: isPending, children: rejectMutation.isPending ? "拒绝中..." : "拒绝" })] }), (approveMutation.isError || rejectMutation.isError) && (_jsxs("p", { className: "mt-2 text-sm text-destructive", children: ["\u64CD\u4F5C\u5931\u8D25\uFF1A", String(approveMutation.error || rejectMutation.error)] }))] }));
}
//# sourceMappingURL=ApprovalPanel.js.map