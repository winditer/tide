"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@tide/ui";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tide/ui";
import {
  useScheduleQuery,
  useScheduleRunsQuery,
  useToggleScheduleMutation,
  useTriggerScheduleMutation,
} from "@tide/core";
import { ScheduleForm, ScheduleRunHistory } from "@tide/views";

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: schedule, isLoading, isError } = useScheduleQuery(id);
  const { data: runs } = useScheduleRunsQuery(id);
  const toggleMutation = useToggleScheduleMutation();
  const triggerMutation = useTriggerScheduleMutation();

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="py-12 text-center text-muted-foreground">加载中...</div>
      </main>
    );
  }

  if (isError || !schedule) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="py-12 text-center text-destructive">加载失败</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
      {/* Header */}
      <header>
        <button
          onClick={() => router.push("/schedules")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-smooth"
        >
          ← 返回调度列表
        </button>
        <div className="mt-3 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{schedule.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                {schedule.trigger_type}
              </span>
              <code className="font-mono text-xs">
                {JSON.stringify(schedule.trigger_config ?? {})}
              </code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={schedule.enabled ? "default" : "secondary"}>
              {schedule.enabled ? "启用" : "停用"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleMutation.mutate(id)}
              disabled={toggleMutation.isPending}
            >
              {schedule.enabled ? "停用" : "启用"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerMutation.mutate(id)}
              disabled={triggerMutation.isPending}
            >
              手动触发
            </Button>
          </div>
        </div>
      </header>

      {/* Info */}
      <section className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <h2 className="text-base font-medium">基本信息</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">任务类型</dt>
            <dd className="mt-0.5 font-medium">{schedule.task_type}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">下次执行</dt>
            <dd className="mt-0.5 font-medium">{formatTime(schedule.next_run_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">上次执行</dt>
            <dd className="mt-0.5 font-medium">{formatTime(schedule.last_run_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">创建时间</dt>
            <dd className="mt-0.5 font-medium">{formatTime(schedule.created_at)}</dd>
          </div>
        </dl>
      </section>

      {/* Edit Form */}
      <section className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <h2 className="text-base font-medium">编辑调度</h2>
        <ScheduleForm schedule={schedule} onSuccess={() => {}} />
      </section>

      {/* Run History */}
      <section className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <h2 className="text-base font-medium">执行历史</h2>
        <ScheduleRunHistory runs={runs ?? []} />
      </section>
    </main>
  );
}
