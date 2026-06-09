"use client";

import { Button } from "@lark2codex/ui";
import {
  useApproveTaskMutation,
  useRejectTaskMutation,
} from "@lark2codex/core";

interface ApprovalPanelProps {
  taskId: string;
  reason?: string | null;
}

export function ApprovalPanel({ taskId, reason }: ApprovalPanelProps) {
  const approveMutation = useApproveTaskMutation();
  const rejectMutation = useRejectTaskMutation();

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync(taskId);
    } catch {
      // handled by mutation state
    }
  };

  const handleReject = async () => {
    try {
      await rejectMutation.mutateAsync({ id: taskId });
    } catch {
      // handled by mutation state
    }
  };

  const isPending = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
      <h4 className="mb-2 font-medium text-yellow-600">审批请求</h4>
      {reason && (
        <p className="mb-3 text-sm text-muted-foreground">{reason}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={isPending}
        >
          {approveMutation.isPending ? "批准中..." : "批准"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleReject}
          disabled={isPending}
        >
          {rejectMutation.isPending ? "拒绝中..." : "拒绝"}
        </Button>
      </div>
      {(approveMutation.isError || rejectMutation.isError) && (
        <p className="mt-2 text-sm text-destructive">
          操作失败：{String(approveMutation.error || rejectMutation.error)}
        </p>
      )}
    </div>
  );
}
