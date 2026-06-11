"use client";

import Link from "next/link";
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

/** 从 transition.output 中尝试解析 session_id（兼容 JSON 与文本两种格式） */
function extractSessionId(output: string | null | undefined): string | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === "object" && typeof parsed.session_id === "string") {
      return parsed.session_id;
    }
  } catch {
    // not JSON, fall through
  }
  const m = output.match(/session[_-]?id["'\s:=]+([0-9a-fA-F-]{8,})/);
  return m ? m[1] : null;
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
              className="h-11 rounded-lg border-0 bg-muted/50 text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              className="w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="描述"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveEdit}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "保存中…" : "保存"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {item.title}
            </h2>
            {item.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={startEditing}>
                编辑
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                删除
              </Button>
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border/50 bg-muted/30 p-4">
          <MetaItem label="优先级">
            <span className={`text-sm font-medium ${prio.color}`}>{prio.label}</span>
          </MetaItem>
          <MetaItem label="负责人">
            <span className="text-sm">
              {item.assignee || <span className="text-muted-foreground">未分配</span>}
            </span>
          </MetaItem>
          <MetaItem label="来源">
            <Badge variant="outline" className="text-[10px]">
              {item.source_type}
            </Badge>
          </MetaItem>
          <MetaItem label="创建时间">
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatTime(item.created_at)}
            </span>
          </MetaItem>
        </div>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              标签
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="rounded-md border-border/60 text-xs"
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
        <div>
          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            流转历史
          </div>
          {transitions && transitions.length > 0 ? (
            <div className="space-y-2">
              {transitions.map((t: WorkItemTransition) => {
                // 流转记录中可能包含关联任务（agent 节点会触发 task），
                // 输出字段也可能内嵌 session_id；提取后渲染快捷链接。
                const sessionId = extractSessionId(t.output);
                return (
                  <div
                    key={t.id}
                    className="rounded-lg border border-border/50 bg-card p-3 shadow-card transition-smooth hover:shadow-card-hover"
                  >
                    <div className="flex items-center gap-3 text-xs">
                      <span className="rounded-md bg-muted/60 px-2 py-0.5 font-mono text-muted-foreground">
                        {t.from_node_id ?? "—"}
                      </span>
                      <span className="text-muted-foreground/60">→</span>
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono font-medium text-primary">
                        {t.to_node_id}
                      </span>
                      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                        {formatTime(t.created_at)}
                      </span>
                    </div>
                    {(t.task_id || sessionId) && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {t.task_id && (
                          <Link
                            href={`/tasks/${t.task_id}`}
                            className="text-primary text-xs hover:underline transition-smooth"
                          >
                            → 查看任务 {t.task_id.slice(0, 8)}
                          </Link>
                        )}
                        {sessionId && (
                          <Link
                            href={`/sessions/${sessionId}`}
                            className="text-primary text-xs hover:underline transition-smooth"
                          >
                            → 查看会话 {sessionId.slice(0, 8)}
                          </Link>
                        )}
                      </div>
                    )}
                    {t.output && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-primary hover:text-primary/80">
                          查看输出
                        </summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/40 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">
                          {t.output}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
              暂无流转记录
            </div>
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
  // 1. 拉取 workflow 以识别当前节点是否为审批节点（仅作为辅助判断、
  //    提供“节点名称”展示；workflow_id 为空时应跳过请求。
  const { data: workflow } = useWorkflow(item.workflow_id || "");
  const currentNode = workflow?.definition?.nodes?.find(
    (n) => n.id === item.current_node_id
  );

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
  const [comment, setComment] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  // 只要存在匹配的 pending 审批就展示入口。之前同时要求
  // “当前节点为 approval 类型”导致 workflow 定义节点 type 不一致时
  // 入口丢失。以是否存在实际的 pending approval 为唯一权威源。
  if (!approval) {
    return null;
  }

  const detail = parseApprovalDetail(approval);
  const reason = (detail.reason as string | undefined) || "";
  const isPending = approveMutation.isPending || rejectMutation.isPending;
  const isApprovalNode = currentNode?.type === "approval";

  const handleApprove = () => {
    setRejectError(null);
    approveMutation.mutate({
      id: approval.id,
      comment: comment.trim() || undefined,
    });
  };
  const handleReject = () => {
    if (!comment.trim()) {
      setRejectError("拒绝时请填写审批意见");
      return;
    }
    setRejectError(null);
    rejectMutation.mutate({
      id: approval.id,
      comment: comment.trim(),
    });
  };

  const error = approveMutation.error || rejectMutation.error;
  const nodeLabel =
    currentNode?.data?.label ||
    item.current_node_id ||
    (isApprovalNode ? "审批节点" : "待人工确认");

  return (
    <div>
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4 shadow-card">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
            <span className="flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            待审批
          </span>
          <Badge
            variant="outline"
            className="rounded-md border-amber-200 bg-background text-[10px] text-amber-800"
          >
            {nodeLabel}
          </Badge>
        </div>

        {reason && (
          <p className="mt-3 rounded-lg border-l-2 border-amber-400 bg-background/70 px-3 py-2 text-xs text-foreground/80">
            {reason}
          </p>
        )}

        {/* 审批意见输入 */}
        <div className="mt-3">
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-amber-800/80">
            审批意见<span className="ml-1 text-amber-700/70">（拒绝时必填）</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              if (rejectError) setRejectError(null);
            }}
            rows={2}
            placeholder="请输入审批意见…"
            className="w-full resize-none rounded-lg border border-amber-200/70 bg-background/80 px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            disabled={isPending}
          />
          {rejectError && (
            <p className="mt-1 text-[11px] text-destructive">{rejectError}</p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="flex-1 bg-emerald-600 text-white shadow-card transition-smooth hover:bg-emerald-700 hover:shadow-card-hover"
            onClick={handleApprove}
            disabled={isPending}
          >
            {approveMutation.isPending ? "审批中…" : "✓ 通过"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-destructive/30 text-destructive transition-smooth hover:bg-destructive/10 hover:text-destructive"
            onClick={handleReject}
            disabled={isPending}
          >
            {rejectMutation.isPending ? "拒绝中…" : "✕ 拒绝"}
          </Button>
        </div>

        {error && (
          <p className="mt-2 text-[11px] text-destructive">
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
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-lg overflow-y-auto rounded-l-2xl border-l border-border/50 bg-card p-6 shadow-2xl animate-in slide-in-from-right-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between border-b border-border/40 pb-4">
          <span className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            工作项详情
          </span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
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
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
