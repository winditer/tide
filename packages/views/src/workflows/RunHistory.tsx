"use client";

import { useRouter } from "next/navigation";
import type { WorkflowRun } from "@tide/core";

const STATUS_TONE: Record<
  string,
  { label: string; bar: string; chip: string; glyph: string }
> = {
  pending: {
    label: "PENDING",
    bar: "bg-zinc-400",
    chip: "bg-zinc-100 text-zinc-700 border-zinc-400",
    glyph: "◇",
  },
  running: {
    label: "RUNNING",
    bar: "bg-sky-500",
    chip: "bg-sky-100 text-sky-800 border-sky-500",
    glyph: "▲",
  },
  completed: {
    label: "DONE",
    bar: "bg-emerald-600",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-600",
    glyph: "■",
  },
  failed: {
    label: "FAILED",
    bar: "bg-rose-600",
    chip: "bg-rose-100 text-rose-800 border-rose-600",
    glyph: "✕",
  },
  cancelled: {
    label: "CANCELLED",
    bar: "bg-zinc-500",
    chip: "bg-zinc-100 text-zinc-700 border-zinc-400",
    glyph: "□",
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
    <div className="overflow-hidden border-2 border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 bg-amber-400" />
          <span className="font-mono text-[11px] tracking-[0.3em]">
            ◴ RUN HISTORY
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-widest text-zinc-400">
          {runs.length} ENTRIES
        </span>
      </div>

      {isLoading ? (
        <div className="px-4 py-8 text-center font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING…
        </div>
      ) : runs.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <div className="font-mono text-[11px] tracking-[0.3em] text-zinc-500">
            ◇ NO RUNS YET
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            点击「运行」按钮触发首次执行
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-zinc-900 bg-zinc-50">
                <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                  STATUS
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                  RUN_ID
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                  STARTED
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                  FINISHED
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                  DURATION
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                  NODES
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const tone = STATUS_TONE[r.status] ?? STATUS_TONE.pending;
                const total = r.node_runs?.length ?? 0;
                const done =
                  r.node_runs?.filter((n) => n.status === "completed").length ??
                  0;
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-zinc-200 transition-colors hover:bg-zinc-50"
                    onClick={() =>
                      router.push(`/workflows/${workflowId}/runs/${r.id}`)
                    }
                  >
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[10px] tracking-[0.2em] ${tone.chip}`}
                      >
                        <span>{tone.glyph}</span>
                        <span>{tone.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-800">
                      {r.id.slice(0, 12)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-700">
                      {formatTime(r.started_at)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-700">
                      {formatTime(r.finished_at)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-900">
                      {formatDuration(r.started_at, r.finished_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-zinc-700">
                          {done}/{total}
                        </span>
                        <div className="h-1.5 w-20 border border-zinc-300 bg-zinc-100">
                          <div
                            className={`h-full ${tone.bar}`}
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
