"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@tide/ui";
import {
  usePlan,
  usePlanTasks,
  useStopPlan,
  type PlanDAGNodeData,
} from "@tide/core";
import {
  PlanDAGView,
  PlanDetailPanel,
  GanttTimeline,
  DiffViewer,
} from "@tide/views";

type Tab = "dag" | "gantt" | "diff";

const TABS: { value: Tab; label: string; mark: string }[] = [
  { value: "dag", label: "DAG", mark: "◇" },
  { value: "gantt", label: "GANTT", mark: "▭" },
  { value: "diff", label: "DIFF", mark: "↔" },
];

const STATUS_DOT: Record<string, string> = {
  active: "bg-amber-500",
  running: "bg-amber-500",
  completed: "bg-emerald-600",
  stopped: "bg-zinc-500",
  failed: "bg-rose-600",
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

export default function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: plan, isLoading, isError } = usePlan(id);
  const { data: tasks } = usePlanTasks(id, { refetchInterval: 5000 });
  const stop = useStopPlan();
  const [tab, setTab] = useState<Tab>("dag");

  // Selected node for the detail panel
  const [selected, setSelected] = useState<{
    taskId: string;
    data: PlanDAGNodeData;
  } | null>(null);

  const handleNodeClick = (nodeId: string, data: PlanDAGNodeData) => {
    // Backend uses node id `task-{task_index}` or task uuid; map to actual task id
    const t = tasks?.find(
      (it) =>
        it.task_id === nodeId ||
        String(it.task_index) === nodeId ||
        nodeId.endsWith(String(it.task_index))
    );
    setSelected({ taskId: t?.task_id ?? nodeId, data });
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2">
        <div className="py-24 text-center font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING PLAN…
        </div>
      </main>
    );
  }

  if (isError || !plan) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2">
        <div className="py-24 text-center font-mono text-xs text-rose-600">
          ✕ PLAN NOT FOUND
        </div>
        <div className="text-center">
          <Button variant="outline" onClick={() => router.push("/plans")}>
            ← 返回列表
          </Button>
        </div>
      </main>
    );
  }

  const canStop = plan.status === "active" || plan.status === "running";
  const taskCount = tasks?.length ?? 0;
  const doneCount =
    tasks?.filter(
      (t) => t.status === "completed" || t.status === "approved"
    ).length ?? 0;

  return (
    <main className="mx-auto max-w-7xl px-2 py-2">
      {/* Header */}
      <header className="mb-6 border-b-2 border-zinc-900 pb-5">
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.3em] text-zinc-500">
          <button
            onClick={() => router.push("/plans")}
            className="hover:text-zinc-900"
          >
            ← PLANS
          </button>
          <span>/</span>
          <span className="text-zinc-700">{plan.id.slice(0, 8)}</span>
        </div>

        <div className="mt-2 flex items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-4xl font-bold leading-none tracking-tight text-zinc-900">
                Plan<span className="text-amber-500">.</span>
                <span className="font-mono text-2xl text-zinc-500">
                  {plan.id.slice(0, 8)}
                </span>
              </h1>
              <span
                className={`inline-flex items-center gap-2 border border-zinc-900 px-2 py-0.5 font-mono text-[10px] tracking-widest text-zinc-900`}
              >
                <span
                  className={`inline-block h-2 w-2 ${STATUS_DOT[plan.status] ?? "bg-slate-400"}`}
                />
                {plan.status.toUpperCase()}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[11px] text-zinc-700">
              <Stat label="TASKS" value={`${doneCount}/${taskCount}`} />
              <Stat label="PARALLEL" value={String(plan.max_parallel)} />
              <Stat label="MODEL" value={plan.model || "—"} />
              <Stat label="CWD" value={plan.cwd || "—"} />
              <Stat label="CREATED" value={formatTime(plan.created_at)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canStop && (
              <Button
                variant="destructive"
                disabled={stop.isPending}
                onClick={() => stop.mutate(plan.id)}
              >
                ■ 停止 Plan
              </Button>
            )}
          </div>
        </div>

        {/* Tab strip */}
        <div className="mt-6 flex items-end border-b border-zinc-300">
          {TABS.map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={[
                  "relative -mb-px flex items-center gap-2 px-5 py-2 font-mono text-[11px] tracking-[0.2em] transition-colors",
                  active
                    ? "border-x border-t border-zinc-900 bg-white text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-900",
                ].join(" ")}
              >
                <span>{t.mark}</span>
                <span>{t.label}</span>
              </button>
            );
          })}
          <div className="ml-auto pb-1 font-mono text-[10px] tracking-widest text-zinc-400">
            VIEW · {tab.toUpperCase()}
          </div>
        </div>
      </header>

      {/* Tab content */}
      <div>
        {tab === "dag" && (
          <div className="h-[680px]">
            <PlanDAGView
              planId={plan.id}
              onNodeClick={handleNodeClick}
              refetchInterval={5000}
            />
          </div>
        )}
        {tab === "gantt" && (
          <GanttTimeline planId={plan.id} refetchInterval={5000} />
        )}
        {tab === "diff" && <DiffViewer planId={plan.id} />}
      </div>

      {/* Detail panel */}
      <PlanDetailPanel
        open={!!selected}
        taskId={selected?.taskId ?? null}
        nodeData={selected?.data ?? null}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[9px] tracking-widest text-zinc-500">{label}</span>
      <span className="text-[12px] font-bold text-zinc-900">{value}</span>
    </div>
  );
}
