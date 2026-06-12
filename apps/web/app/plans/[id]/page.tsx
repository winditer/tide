"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from "@tide/ui";
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
    // Backend DAG node id format: `task-{task_uuid}`. Strip prefix to get raw task id.
    const stripped = nodeId.startsWith("task-") ? nodeId.slice(5) : nodeId;
    const t = tasks?.find(
      (it) =>
        it.task_id === stripped ||
        it.task_id === nodeId ||
        String(it.task_index) === stripped
    );
    setSelected({ taskId: t?.task_id ?? stripped, data });
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2">
        <div className="py-24 text-center text-sm text-muted-foreground">
          加载计划中…
        </div>
      </main>
    );
  }

  if (isError || !plan) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2">
        <div className="py-24 text-center text-sm text-destructive">
          计划不存在
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
    <main className="mx-auto max-w-7xl px-2 py-2 space-y-8">
      {/* Header */}
      <header>
        <button
          onClick={() => router.push("/plans")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-smooth"
        >
          ← 返回计划列表
        </button>

        <div className="mt-3 flex items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                Plan <span className="font-mono text-base text-muted-foreground">{plan.id.slice(0, 8)}</span>
              </h1>
              <span className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[10px] tracking-widest">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[plan.status] ?? "bg-slate-400"}`}
                />
                {plan.status.toUpperCase()}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <Stat label="任务" value={`${doneCount}/${taskCount}`} />
              <Stat label="并发" value={String(plan.max_parallel)} />
              <Stat label="模型" value={plan.model || "—"} />
              <Stat label="工作目录" value={plan.cwd || "—"} />
              <Stat label="创建" value={formatTime(plan.created_at)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canStop && (
              <Button
                variant="destructive"
                disabled={stop.isPending}
                onClick={() => stop.mutate(plan.id)}
              >
                ■ 停止
              </Button>
            )}
          </div>
        </div>

        {/* Tab strip + content */}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="mt-6"
        >
          <TabsList className="h-auto w-full justify-start gap-1 rounded-xl border border-border/50 bg-muted/40 p-1">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="rounded-lg px-4 py-1.5 text-sm font-medium transition-smooth data-[state=active]:bg-card data-[state=active]:shadow-card data-[state=active]:text-foreground"
              >
                <span className="mr-2 text-muted-foreground data-[state=active]:text-primary">{t.mark}</span>
                <span>{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="dag" className="mt-4">
            <div className="h-[680px]">
              <PlanDAGView
                planId={plan.id}
                onNodeClick={handleNodeClick}
                refetchInterval={5000}
              />
            </div>
          </TabsContent>
          <TabsContent value="gantt" className="mt-4">
            <GanttTimeline planId={plan.id} refetchInterval={5000} />
          </TabsContent>
          <TabsContent value="diff" className="mt-4">
            <DiffViewer planId={plan.id} />
          </TabsContent>
        </Tabs>
      </header>

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
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}
