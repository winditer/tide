"use client";

import { Button } from "@tide/ui";
import {
  useTaskQuery,
  useStopTaskMutation,
  useRetryTaskMutation,
  useApproveTaskMutation,
  useRejectTaskMutation,
} from "@tide/core";
import type { PlanDAGNodeData } from "@tide/core";

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  review: "待审批",
  approved: "已批准",
  completed: "已完成",
  failed: "失败",
  rejected: "已拒绝",
  stopped: "已停止",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<string, string> = {
  queued: "bg-slate-400",
  running: "bg-amber-500",
  review: "bg-violet-500",
  approved: "bg-emerald-500",
  completed: "bg-emerald-600",
  failed: "bg-rose-600",
  rejected: "bg-rose-500",
  stopped: "bg-zinc-500",
  cancelled: "bg-zinc-500",
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

interface PlanDetailPanelProps {
  taskId: string | null;
  nodeData?: PlanDAGNodeData | null;
  open: boolean;
  onClose: () => void;
}

export function PlanDetailPanel({
  taskId,
  nodeData,
  open,
  onClose,
}: PlanDetailPanelProps) {
  const { data: task, isLoading } = useTaskQuery(taskId ?? "");
  const stop = useStopTaskMutation();
  const retry = useRetryTaskMutation();
  const approve = useApproveTaskMutation();
  const reject = useRejectTaskMutation();

  if (!open) return null;

  const status = String(task?.status ?? nodeData?.status ?? "queued");
  const title = nodeData?.title ?? task?.prompt?.slice(0, 60) ?? "Untitled";
  const agent = nodeData?.agentId ?? nodeData?.agent_id ?? task?.agent_id ?? "—";

  const canStop = status === "queued" || status === "running";
  const canRetry =
    status === "failed" || status === "stopped" || status === "rejected";
  const needsApproval = status === "review";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className={[
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-[460px] flex-col",
          "border-l border-border/50 bg-card",
          "shadow-[-8px_0_24px_-4px_rgba(0,0,0,0.1)]",
          "animate-in slide-in-from-right duration-200",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              任务详情
            </span>
            <span
              className={`inline-flex h-2 w-2 rounded-full ${STATUS_COLOR[status] ?? "bg-slate-400"}`}
            />
            <span className="text-xs font-medium text-foreground">
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground transition-smooth"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          <div className="border-b border-border/50 px-5 py-4">
            <div className="text-[10px] font-medium text-muted-foreground">
              标题
            </div>
            <h3 className="mt-1 text-base font-semibold leading-snug text-foreground">
              {title}
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border/50 px-5 py-4 text-sm">
            <Field label="Agent" value={agent || "—"} mono />
            <Field
              label="模型"
              value={task?.model ?? "—"}
              mono
            />
            <Field
              label="耗时"
              value={formatDuration(task?.duration_ms ?? null)}
              mono
            />
            <Field
              label="阶段"
              value={String(nodeData?.phase ?? 0)}
              mono
            />
            <Field
              label="开始"
              value={formatTime(task?.started_at ?? null)}
            />
            <Field
              label="完成"
              value={formatTime(task?.completed_at ?? null)}
            />
          </div>

          {isLoading ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              加载中…
            </div>
          ) : task ? (
            <>
              <Section title="Prompt">
                <pre className="whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 p-3 font-mono text-[12px] leading-relaxed text-foreground">
                  {task.prompt}
                </pre>
              </Section>

              {task.result && (
                <Section title="输出">
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-emerald-200">
                    {task.result}
                  </pre>
                </Section>
              )}

              {task.diff_summary && (
                <Section title="Diff 摘要">
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 p-3 font-mono text-[11px] text-foreground">
                    {task.diff_summary}
                  </pre>
                </Section>
              )}
            </>
          ) : (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              暂无任务详情
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 bg-muted/30 px-5 py-3">
          {needsApproval && task && (
            <>
              <Button
                size="sm"
                disabled={approve.isPending}
                onClick={() => approve.mutate(task.id)}
              >
                ✓ 批准
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={reject.isPending}
                onClick={() => reject.mutate({ id: task.id })}
              >
                ✕ 拒绝
              </Button>
            </>
          )}
          {canStop && task && (
            <Button
              size="sm"
              variant="destructive"
              disabled={stop.isPending}
              onClick={() => stop.mutate(task.id)}
            >
              ■ 停止
            </Button>
          )}
          {canRetry && task && (
            <Button
              size="sm"
              variant="outline"
              disabled={retry.isPending}
              onClick={() => retry.mutate(task.id)}
            >
              ↻ 重试
            </Button>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            ID · {task?.id?.slice(0, 8) ?? "—"}
          </span>
        </div>
      </aside>
    </>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-foreground ${mono ? "font-mono text-[12px]" : "text-[13px]"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/50 px-5 py-4">
      <div className="mb-2 text-[10px] font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
