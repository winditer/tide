"use client";

import { Button } from "@lark2codex/ui";
import {
  useTaskQuery,
  useStopTaskMutation,
  useRetryTaskMutation,
  useApproveTaskMutation,
  useRejectTaskMutation,
} from "@lark2codex/core";
import type { PlanDAGNodeData } from "@lark2codex/core";

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
          "border-l-2 border-zinc-900 bg-white",
          "shadow-[-12px_0_0_0_rgba(24,24,27,0.04)]",
          "animate-in slide-in-from-right duration-200",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-900 bg-zinc-950 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              TASK / NODE
            </span>
            <span
              className={`inline-flex h-2 w-2 ${STATUS_COLOR[status] ?? "bg-slate-400"}`}
            />
            <span className="font-mono text-[11px] uppercase tracking-widest">
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-sm text-zinc-300 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          <div className="border-b border-dashed border-zinc-300 px-5 py-4">
            <div className="font-mono text-[10px] tracking-widest text-zinc-500">
              TITLE
            </div>
            <h3 className="mt-1 text-base font-bold leading-snug text-zinc-900">
              {title}
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-dashed border-zinc-300 px-5 py-4 text-sm">
            <Field label="AGENT" value={agent || "—"} mono />
            <Field
              label="MODEL"
              value={task?.model ?? "—"}
              mono
            />
            <Field
              label="DURATION"
              value={formatDuration(task?.duration_ms ?? null)}
              mono
            />
            <Field
              label="PHASE"
              value={String(nodeData?.phase ?? 0)}
              mono
            />
            <Field
              label="STARTED"
              value={formatTime(task?.started_at ?? null)}
            />
            <Field
              label="COMPLETED"
              value={formatTime(task?.completed_at ?? null)}
            />
          </div>

          {isLoading ? (
            <div className="px-5 py-8 text-center font-mono text-xs text-zinc-500">
              ◐ LOADING…
            </div>
          ) : task ? (
            <>
              <Section title="PROMPT">
                <pre className="whitespace-pre-wrap break-words rounded-sm border border-zinc-200 bg-zinc-50 p-3 font-mono text-[12px] leading-relaxed text-zinc-800">
                  {task.prompt}
                </pre>
              </Section>

              {task.result && (
                <Section title="OUTPUT">
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-zinc-200 bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-emerald-200">
                    {task.result}
                  </pre>
                </Section>
              )}

              {task.diff_summary && (
                <Section title="DIFF SUMMARY">
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] text-zinc-700">
                    {task.diff_summary}
                  </pre>
                </Section>
              )}
            </>
          ) : (
            <div className="px-5 py-8 text-center font-mono text-xs text-zinc-500">
              ◇ NO TASK DETAILS
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-900 bg-zinc-50 px-5 py-3">
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
          <span className="ml-auto font-mono text-[10px] tracking-widest text-zinc-400">
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
      <div className="font-mono text-[10px] tracking-widest text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-zinc-900 ${mono ? "font-mono text-[12px]" : "text-[13px]"}`}
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
    <div className="border-b border-dashed border-zinc-300 px-5 py-4">
      <div className="mb-2 font-mono text-[10px] tracking-widest text-zinc-500">
        {title}
      </div>
      {children}
    </div>
  );
}
