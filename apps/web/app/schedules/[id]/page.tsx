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
    <main className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2"
            onClick={() => router.push("/schedules")}
          >
            ← 返回列表
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{schedule.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
              {schedule.trigger_type}
            </span>
            <code className="font-mono">
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

      {/* Info */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {/* Edit Form */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">编辑调度</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleForm schedule={schedule} onSuccess={() => {}} />
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">执行历史</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleRunHistory runs={runs ?? []} />
        </CardContent>
      </Card>
    </main>
  );
}
