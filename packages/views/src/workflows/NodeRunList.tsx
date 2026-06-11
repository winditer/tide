"use client";

import type { WorkflowNodeRun, WorkflowRun } from "@tide/core";
import { STATUS_BG, STATUS_LABEL, statusTone } from "./node-tones";

interface NodeRunListProps {
  run: WorkflowRun;
  onApprove?: (nodeId: string) => void;
  onReject?: (nodeId: string) => void;
  isPending?: boolean;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("zh-CN");
  } catch {
    return iso;
  }
}

export function NodeRunList({
  run,
  onApprove,
  onReject,
  isPending,
}: NodeRunListProps) {
  const runs: WorkflowNodeRun[] = run.node_runs ?? [];

  return (
    <div className="overflow-hidden bg-card rounded-xl shadow-card border border-border/50">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
          <span className="text-xs font-medium text-foreground">
            节点执行记录
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {runs.length} 个节点
        </span>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {runs.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            尚无节点执行记录
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {runs.map((nr) => {
              const tone = statusTone(nr.status);
              const needsApproval =
                nr.node_type === "approval" && nr.status === "running";
              return (
                <li key={nr.id} className="px-4 py-3 hover:bg-muted/30 transition-smooth">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tone.accent} ${tone.pulse}`}
                    >
                      <span className="text-[10px] text-white">
                        {tone.glyph}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {nr.node_id}
                        </span>
                        <span className="rounded-md border border-border bg-muted px-1.5 py-[1px] text-[9px] uppercase text-muted-foreground">
                          {nr.node_type}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span
                          className={`rounded-md px-1.5 py-[1px] ${
                            STATUS_BG[nr.status] ?? "bg-muted"
                          }`}
                        >
                          {STATUS_LABEL[nr.status] ?? nr.status}
                        </span>
                        <span>开始 {formatTime(nr.started_at)}</span>
                        <span>结束 {formatTime(nr.finished_at)}</span>
                      </div>
                      {nr.error && (
                        <div className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] leading-relaxed text-rose-800">
                          {String(nr.error)}
                        </div>
                      )}
                      {nr.output != null && (
                        <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[10px] leading-relaxed text-foreground">
                          {typeof nr.output === "string"
                            ? nr.output
                            : JSON.stringify(nr.output, null, 2)}
                        </pre>
                      )}
                    </div>
                    {needsApproval && (
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          disabled={isPending}
                          onClick={() => onApprove?.(nr.node_id)}
                          className="rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-400 disabled:opacity-50 transition-smooth"
                        >
                          ✓ 批准
                        </button>
                        <button
                          disabled={isPending}
                          onClick={() => onReject?.(nr.node_id)}
                          className="rounded-md bg-rose-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-rose-400 disabled:opacity-50 transition-smooth"
                        >
                          ✕ 拒绝
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
