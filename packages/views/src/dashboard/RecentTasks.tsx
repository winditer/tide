"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Badge } from "@tide/ui";
import { useRecentTasks } from "@tide/core";
import type { RecentTask } from "@tide/core";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "secondary",
  running: "default",
  review: "outline",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  approved: "secondary",
  rejected: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  review: "待审批",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  approved: "已批准",
  rejected: "已拒绝",
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncate(str: string, max = 60) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function TaskRow({ task }: { task: RecentTask }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex items-center gap-3 px-5 py-3 transition-smooth hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{truncate(task.prompt)}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {task.agent_id && (
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">
              {task.agent_id}
            </span>
          )}
          <span>{formatTime(task.created_at)}</span>
        </div>
      </div>
      <Badge variant={STATUS_VARIANT[task.status] ?? "outline"} className="shrink-0">
        {STATUS_LABEL[task.status] ?? task.status}
      </Badge>
    </Link>
  );
}

export function RecentTasks() {
  const { data, isLoading, isError } = useRecentTasks(10);
  const tasks = data?.tasks ?? [];

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 shadow-sm backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-gray-200/60 px-5 py-4">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            最近任务
          </h2>
        </div>
        <Link
          href="/tasks"
          className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          查看全部 →
        </Link>
      </header>
      <div className="px-0 py-0">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">加载中...</div>
        ) : isError ? (
          <div className="py-10 text-center text-sm text-red-500">加载失败</div>
        ) : tasks.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">暂无任务</div>
        ) : (
          <div className="divide-y divide-gray-200/60">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
