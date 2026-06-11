"use client";

import { useState } from "react";
import { Button, Badge, Input } from "@tide/ui";
import {
  useWorkItem,
  useWorkItemTransitions,
  useUpdateWorkItem,
  useDeleteWorkItem,
  useWorkflow,
  useApprovals,
  useApproveApproval,
  useRejectApproval,
  parseApprovalDetail,
  type WorkItem,
  type WorkItemTransition,
  type Approval,
} from "@tide/core";

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "无", color: "text-zinc-500" },
  1: { label: "低", color: "text-blue-600" },
  2: { label: "中", color: "text-amber-600" },
  3: { label: "高", color: "text-orange-600" },
  4: { label: "紧急", color: "text-rose-600" },
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface WorkItemDetailPanelProps {
  itemId: string;
  onClose: () => void;
}

export function WorkItemDetailPanel({
  itemId,
  onClose,
}: WorkItemDetailPanelProps) {
  const { data: item, isLoading } = useWorkItem(itemId);
  const { data: transitions } = useWorkItemTransitions(itemId);
  const updateMutation = useUpdateWorkItem();
  const deleteMutation = useDeleteWorkItem();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const startEditing = () => {
    if (!item) return;
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!item) return;
    await updateMutation.mutateAsync({
      id: item.id,
      data: {
        title: editTitle.trim() || item.title,
        description: editDescription.trim() || undefined,
      },
    });
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!confirm("确定删除该工作项？")) return;
    await deleteMutation.mutateAsync(item.id);
    onClose();
  };

  if (isLoading || !item) {
    return (
      <PanelShell onClose={onClose}>
        <div className="py-12 text-center font-mono text-xs text-zinc-500">
          ◐ LOADING…
        </div>
      </PanelShell>
    );
  }

  const prio = PRIORITY_LABELS[item.priority] ?? PRIORITY_LABELS[0];

  return (
    <PanelShell onClose={onClose}>
      <div className="space-y-6">
        {/* Title area */}
        {editing ? (
          <div className="space-y-3">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="border-2 border-zinc-900 text-lg font-semibold"
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border-2 border-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              placeholder="描述"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="border-2 border-zinc-900 bg-emerald-600 text-white"
                onClick={saveEdit}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "保存中…" : "保存"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-2 border-zinc-900"
                onClick={() => setEditing(false)}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="font-serif text-2xl font-bold text-zinc-900">
              {item.title}
            </h2>
            {item.description && (
              <p className="mt-2 text-sm text-zinc-600">{item.description}</p>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-2 border-zinc-900"
                onClick={startEditing}
              >
                编辑
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-2 border-rose-500 text-rose-600 hover:bg-rose-50"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                删除
              </Button>
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3 border-t border-zinc-200 pt-4">
          <MetaItem label="优先级">
            <span className={`font-medium ${prio.color}`}>{prio.label}</span>
          </MetaItem>
          <MetaItem label="负责人">
            <span className="font-mono text-sm">
              {item.assignee || "未分配"}
            </span>
          </MetaItem>
          <MetaItem label="来源">
            <Badge variant="outline" className="text-[10px]">
              {item.source_type}
            </Badge>
          </MetaItem>
          <MetaItem label="创建时间">
            <span className="font-mono text-[11px]">
              {formatTime(item.created_at)}
            </span>
          </MetaItem>
        </div>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="border-t border-zinc-200 pt-4">
            <div className="mb-2 font-mono text-[11px] tracking-widest text-zinc-500">
              TAGS
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="border-zinc-300 text-xs"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Approval action area */}
        <WorkItemApprovalSection item={item} />

        {/* Transitions */}
        <div className="border-t border-zinc-200 pt-4">
          <div className="mb-3 font-mono text-[11px] tracking-widest text-zinc-500">
            TRANSITION HISTORY
          </div>
          {transitions && transitions.length > 0 ? (
            <div className="space-y-2">
              {transitions.map((t: WorkItemTransition) => (
                <div
                  key={t.id}
                  className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2"
                >
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono text-zinc-500">
                      {t.from_node_id ?? "—"}
                    </span>
                    <span className="text-zinc-400">→</span>
                    <span className="font-mono font-medium text-zinc-800">
                      {t.to_node_id}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">
                      {formatTime(t.created_at)}
                    </span>
                  </div>
                  {t.output && (
                    <details className="mt-2">
                      <summary className="cursor-pointer font-mono text-[10px] tracking-widest text-emerald-700 hover:text-emerald-900">
                        ▸ OUTPUT
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-[11px] leading-relaxed text-zinc-100">
                        {t.output}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-zinc-400">暂无流转记录</div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

interface WorkItemApprovalSectionProps {
  item: WorkItem;
}

function WorkItemApprovalSection({ item }: WorkItemApprovalSectionProps) {
  // 1. 判断当前节点是否为 approval 类型
  const { data: workflow } = useWorkflow(item.workflow_id);
  const currentNode = workflow?.definition?.nodes?.find(
    (n) => n.id === item.current_node_id
  );
  const isApprovalNode = currentNode?.type === "approval";

  // 2. 拉取 pending 审批列表，筛选出当前工作项的审批
  const { data: approvalsData } = useApprovals({ status: "pending" });
  const approval: Approval | undefined = (approvalsData?.items ?? []).find(
    (a) => {
      const detail = parseApprovalDetail(a);
      return (
        a.type === "work_item_transition" && detail.work_item_id === item.id
      );
    }
  );

  const approveMutation = useApproveApproval();
  const rejectMutation = useRejectApproval();

  if (!isApprovalNode || !approval) {
    return null;
  }

  const detail = parseApprovalDetail(approval);
  const reason = (detail.reason as string | undefined) || "";
  const isPending = approveMutation.isPending || rejectMutation.isPending;

  const handleApprove = () => {
    approveMutation.mutate({ id: approval.id });
  };
  const handleReject = () => {
    rejectMutation.mutate({ id: approval.id });
  };

  const error = approveMutation.error || rejectMutation.error;

  return (
    <div className="border-t border-zinc-200 pt-4">
      <div className="border-2 border-zinc-900 bg-amber-50 p-4 shadow-[4px_4px_0_0_rgba(24,24,27,1)]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-widest text-zinc-900">
            APPROVAL · PENDING
          </span>
          <Badge
            variant="outline"
            className="border-2 border-zinc-900 bg-white font-mono text-[10px] tracking-widest"
          >
            {currentNode?.data?.label || item.current_node_id}
          </Badge>
        </div>

        {reason && (
          <p className="mt-3 border-l-2 border-zinc-900 bg-white px-3 py-2 font-mono text-xs text-zinc-800">
            {reason}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="flex-1 border-2 border-zinc-900 bg-emerald-500 font-mono text-xs tracking-widest text-white shadow-[2px_2px_0_0_rgba(24,24,27,1)] hover:bg-emerald-600"
            onClick={handleApprove}
            disabled={isPending}
          >
            {approveMutation.isPending ? "◐ APPROVING…" : "✓ APPROVE"}
          </Button>
          <Button
            size="sm"
            className="flex-1 border-2 border-zinc-900 bg-rose-500 font-mono text-xs tracking-widest text-white shadow-[2px_2px_0_0_rgba(24,24,27,1)] hover:bg-rose-600"
            onClick={handleReject}
            disabled={isPending}
          >
            {rejectMutation.isPending ? "◐ REJECTING…" : "✕ REJECT"}
          </Button>
        </div>

        {error && (
          <p className="mt-2 font-mono text-[11px] text-rose-700">
            操作失败：{String(error)}
          </p>
        )}
      </div>
    </div>
  );
}

function PanelShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-lg overflow-y-auto border-l-2 border-zinc-900 bg-white p-6 shadow-[-8px_0_24px_rgba(0,0,0,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-[0.3em] text-zinc-500">
            WORK ITEM · DETAIL
          </span>
          <button
            onClick={onClose}
            className="font-mono text-sm text-zinc-400 hover:text-zinc-900"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MetaItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-widest text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
