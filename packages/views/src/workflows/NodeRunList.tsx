"use client";

import type { WorkflowNodeRun, WorkflowRun } from "@lark2codex/core";
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
    <div className="overflow-hidden border-2 border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
      <div className="flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 bg-sky-400" />
          <span className="font-mono text-[11px] tracking-[0.3em]">
            ◴ NODE TRACE
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-widest text-zinc-400">
          {runs.length} NODES
        </span>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {runs.length === 0 ? (
          <div className="px-4 py-8 text-center font-mono text-xs text-zinc-500">
            ◇ 尚无节点执行记录
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {runs.map((nr) => {
              const tone = statusTone(nr.status);
              const needsApproval =
                nr.node_type === "approval" && nr.status === "running";
              return (
                <li key={nr.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center border border-zinc-900 ${tone.accent} ${tone.pulse}`}
                    >
                      <span className="font-mono text-[10px] text-white">
                        {tone.glyph}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-bold text-zinc-900">
                          {nr.node_id}
                        </span>
                        <span className="border border-zinc-300 bg-zinc-50 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-zinc-700">
                          {nr.node_type}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 font-mono text-[10px] text-zinc-600">
                        <span
                          className={`px-1.5 py-[1px] ${
                            STATUS_BG[nr.status] ?? "bg-zinc-100"
                          }`}
                        >
                          {STATUS_LABEL[nr.status] ?? nr.status}
                        </span>
                        <span>▸ {formatTime(nr.started_at)}</span>
                        <span>◂ {formatTime(nr.finished_at)}</span>
                      </div>
                      {nr.error && (
                        <div className="mt-1.5 border border-rose-300 bg-rose-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-rose-800">
                          ✕ {String(nr.error)}
                        </div>
                      )}
                      {nr.output != null && (
                        <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-800">
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
                          className="border-2 border-emerald-700 bg-emerald-500 px-2 py-[2px] font-mono text-[10px] tracking-wider text-white shadow-[2px_2px_0_0_rgba(4,120,87,0.92)] hover:bg-emerald-400 disabled:opacity-50"
                        >
                          ✓ 批准
                        </button>
                        <button
                          disabled={isPending}
                          onClick={() => onReject?.(nr.node_id)}
                          className="border-2 border-rose-700 bg-rose-500 px-2 py-[2px] font-mono text-[10px] tracking-wider text-white shadow-[2px_2px_0_0_rgba(190,18,60,0.92)] hover:bg-rose-400 disabled:opacity-50"
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
