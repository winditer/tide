"use client";

import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@lark2codex/ui";
import { useRecentTasks } from "@lark2codex/core";
import type { RecentTask } from "@lark2codex/core";

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
      className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{truncate(task.prompt)}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {task.agent_id && (
            <span className="font-mono bg-secondary rounded px-1.5 py-0.5">
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">最近任务</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        ) : isError ? (
          <div className="py-8 text-center text-sm text-destructive">加载失败</div>
        ) : tasks.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">暂无任务</div>
        ) : (
          <div className="divide-y">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
