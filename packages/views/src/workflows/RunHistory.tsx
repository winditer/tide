"use client";

import { useRouter } from "next/navigation";
import type { WorkflowRun } from "@tide/core";

const STATUS_TONE: Record<
  string,
  { label: string; bar: string; dot: string }
> = {
  pending: {
    label: "等待",
    bar: "bg-zinc-400",
    dot: "bg-zinc-400",
  },
  running: {
    label: "运行中",
    bar: "bg-sky-500",
    dot: "bg-sky-500",
  },
  completed: {
    label: "完成",
    bar: "bg-emerald-600",
    dot: "bg-emerald-600",
  },
  failed: {
    label: "失败",
    bar: "bg-rose-600",
    dot: "bg-rose-600",
  },
  cancelled: {
    label: "已取消",
    bar: "bg-zinc-500",
    dot: "bg-zinc-500",
  },
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  const ms = b - a;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

interface RunHistoryProps {
  workflowId: string;
  runs: WorkflowRun[];
  isLoading?: boolean;
}

export function RunHistory({ workflowId, runs, isLoading }: RunHistoryProps) {
  const router = useRouter();

  return (
    <div className="overflow-hidden bg-card rounded-xl shadow-card border border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-xs font-medium text-foreground">
            运行历史
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {runs.length} 条记录
        </span>
      </div>

      {isLoading ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          加载中…
        </div>
      ) : runs.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <div className="text-xs font-medium text-muted-foreground">
            暂无运行记录
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            点击「运行」按钮触发首次执行
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  状态
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  运行 ID
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  开始时间
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  结束时间
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  耗时
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  节点
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {runs.map((r) => {
                const tone = STATUS_TONE[r.status] ?? STATUS_TONE.pending;
                const total = r.node_runs?.length ?? 0;
                const done =
                  r.node_runs?.filter((n) => n.status === "completed").length ??
                  0;
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer transition-colors hover:bg-muted/30"
                    onClick={() =>
                      router.push(`/workflows/${workflowId}/runs/${r.id}`)
                    }
                  >
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium">
                        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                        {tone.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {r.id.slice(0, 12)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatTime(r.started_at)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatTime(r.finished_at)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">
                      {formatDuration(r.started_at, r.finished_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {done}/{total}
                        </span>
                        <div className="h-1.5 w-20 rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${tone.bar}`}
                            style={{
                              width: total
                                ? `${Math.min(
                                    100,
                                    Math.round((done / total) * 100)
                                  )}%`
                                : "0%",
                            }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
