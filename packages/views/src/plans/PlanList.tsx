"use client";

import { useRouter } from "next/navigation";
import { Button } from "@tide/ui";
import type { Plan } from "@tide/core";

const STATUS_TONE: Record<string, { dot: string; label: string }> = {
  active: { dot: "bg-amber-500", label: "ACTIVE" },
  running: { dot: "bg-amber-500", label: "RUNNING" },
  completed: { dot: "bg-emerald-600", label: "COMPLETED" },
  stopped: { dot: "bg-zinc-500", label: "STOPPED" },
  failed: { dot: "bg-rose-600", label: "FAILED" },
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function parseTaskCount(definition: string | null | undefined) {
  if (!definition) return 0;
  try {
    const obj = JSON.parse(definition);
    if (Array.isArray(obj?.tasks)) return obj.tasks.length;
  } catch {
    // ignore
  }
  return 0;
}

interface PlanListProps {
  plans: Plan[];
  onCreate?: () => void;
}

export function PlanList({ plans, onCreate }: PlanListProps) {
  const router = useRouter();

  if (plans.length === 0) {
    return (
      <div className="border border-zinc-900 bg-white p-12 text-center shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
        <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
          ◇ NO PLANS YET
        </div>
        <p className="mt-3 text-sm text-zinc-700">
          Create your first multi-task plan with dependency graph & approvals.
        </p>
        {onCreate && (
          <Button className="mt-4" onClick={onCreate}>
            ▶ 新建 Plan
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan, idx) => {
        const tone =
          STATUS_TONE[plan.status] ?? { dot: "bg-slate-400", label: plan.status };
        const taskCount = parseTaskCount(plan.definition);

        return (
          <button
            key={plan.id}
            onClick={() => router.push(`/plans/${plan.id}`)}
            className="group relative overflow-hidden border border-zinc-900 bg-white text-left shadow-[6px_6px_0_0_rgba(24,24,27,0.92)] transition-transform duration-150 hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_rgba(24,24,27,0.92)]"
          >
            {/* Top status bar */}
            <div
              className={`flex items-center justify-between ${tone.dot} px-3 py-1.5 text-white`}
            >
              <span className="font-mono text-[10px] tracking-[0.25em]">
                PLAN · {tone.label}
              </span>
              <span className="font-mono text-[10px]">
                {String(idx + 1).padStart(3, "0")}
              </span>
            </div>

            <div className="p-4">
              {/* Big monospace ID */}
              <div className="mb-3 font-mono text-[18px] font-bold leading-none tracking-tight text-zinc-900">
                {plan.id.slice(0, 8)}
                <span className="text-zinc-300">·</span>
                <span className="text-[12px] font-medium text-zinc-500">
                  {plan.id.slice(8, 14)}
                </span>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-4 border-y border-dashed border-zinc-300 py-3 font-mono text-[11px]">
                <Stat label="TASKS" value={String(taskCount)} />
                <Stat label="PARALLEL" value={String(plan.max_parallel)} />
                <Stat label="MODEL" value={plan.model || "—"} />
              </div>

              {/* Meta */}
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="text-zinc-500">CREATED</div>
                <div className="text-right text-zinc-800">
                  {formatTime(plan.created_at)}
                </div>
                <div className="text-zinc-500">FINISHED</div>
                <div className="text-right text-zinc-800">
                  {formatTime(plan.completed_at)}
                </div>
              </div>

              {/* CTA */}
              <div className="mt-4 flex items-center justify-between font-mono text-[10px] tracking-widest text-zinc-700">
                <span className="opacity-0 transition-opacity group-hover:opacity-100">
                  → INSPECT DAG
                </span>
                <span>{plan.workspace_id || "default"}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] tracking-widest text-zinc-500">{label}</div>
      <div className="text-[13px] font-bold text-zinc-900">{value}</div>
    </div>
  );
}
