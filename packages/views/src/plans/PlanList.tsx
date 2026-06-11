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
      <div className="bg-card rounded-xl p-12 text-center">
        <div className="text-xs font-medium text-muted-foreground">
          暂无 Plan
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          创建你的第一个多任务计划，支持依赖图与审批。
        </p>
        {onCreate && (
          <Button className="mt-4" onClick={onCreate}>
            + 新建 Plan
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 p-4">
      {plans.map((plan) => {
        const tone =
          STATUS_TONE[plan.status] ?? { dot: "bg-slate-400", label: plan.status };
        const taskCount = parseTaskCount(plan.definition);

        return (
          <button
            key={plan.id}
            onClick={() => router.push(`/plans/${plan.id}`)}
            className="group relative overflow-hidden bg-card rounded-lg p-4 shadow-sm hover:shadow-card-hover transition-smooth border border-border/50 text-left"
          >
            {/* Header with status */}
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-lg font-semibold tracking-tight text-foreground">
                {plan.id.slice(0, 8)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wider">
                <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} />
                {tone.label}
              </span>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 border-t border-border/50 pt-3 text-[11px]">
              <Stat label="任务" value={String(taskCount)} />
              <Stat label="并发" value={String(plan.max_parallel)} />
              <Stat label="模型" value={plan.model || "—"} />
            </div>

            {/* Meta */}
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div className="text-muted-foreground">创建</div>
              <div className="text-right text-foreground">
                {formatTime(plan.created_at)}
              </div>
              <div className="text-muted-foreground">完成</div>
              <div className="text-right text-foreground">
                {formatTime(plan.completed_at)}
              </div>
            </div>

            {/* Footer */}
            <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                查看详情 →
              </span>
              <span>{plan.workspace_id || "default"}</span>
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
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-[13px] font-semibold text-foreground">{value}</div>
    </div>
  );
}
