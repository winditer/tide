"use client";

import Link from "next/link";
import { Badge } from "@tide/ui";
import type { ScheduleRun } from "@tide/core";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  success: "secondary",
  completed: "secondary",
  failed: "destructive",
  running: "default",
};

const STATUS_LABEL: Record<string, string> = {
  success: "成功",
  completed: "成功",
  failed: "失败",
  running: "运行中",
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

/** 超时阈值: 1小时 */
const TIMEOUT_MS = 60 * 60 * 1000;

function calcDuration(started: string, finished: string | null): string {
  if (!finished) {
    // 没有结束时间：判断是否超时
    const elapsed = Date.now() - new Date(started).getTime();
    if (elapsed > TIMEOUT_MS) {
      return "已超时";
    }
    return "进行中";
  }
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

/** 根据 task_type 和 task_id 生成跳转链接 */
function getTaskLink(run: ScheduleRun): { href: string; label: string } | null {
  if (!run.task_id) return null;
  const label = run.task_title || run.task_id.slice(0, 8);
  if (run.task_type === "plan") {
    return { href: `/plans/${run.task_id}`, label };
  }
  if (run.task_type === "workflow") {
    return { href: `/workflows/${run.task_id}`, label };
  }
  // default: link to tasks
  return { href: `/tasks/${run.task_id}`, label };
}

interface ScheduleRunHistoryProps {
  runs: ScheduleRun[] | { items: ScheduleRun[] } | null | undefined;
}

export function ScheduleRunHistory({ runs }: ScheduleRunHistoryProps) {
  // 后端可能返回数组或 { items: [...] } 包装体，这里统一做防护。
  const safeRuns: ScheduleRun[] = Array.isArray(runs)
    ? runs
    : Array.isArray((runs as { items?: ScheduleRun[] } | null | undefined)?.items)
      ? (runs as { items: ScheduleRun[] }).items
      : [];

  if (safeRuns.length === 0) {
    return (
      <div className="bg-card rounded-xl shadow-card overflow-hidden">
        <div className="py-12 text-center text-sm text-muted-foreground">
          暂无执行记录
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">关联任务</th>
              <th className="px-4 py-3 font-medium">开始时间</th>
              <th className="px-4 py-3 font-medium">结束时间</th>
              <th className="px-4 py-3 font-medium">耗时</th>
              <th className="px-4 py-3 font-medium">错误信息</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {safeRuns.map((run) => {
              const endTime = run.finished_at || run.completed_at;
              const taskLink = getTaskLink(run);
              return (
                <tr
                  key={run.id}
                  className="hover:bg-muted/50 transition-smooth"
                >
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>
                      {STATUS_LABEL[run.status] ?? run.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 max-w-[180px] truncate">
                    {taskLink ? (
                      <Link
                        href={taskLink.href}
                        className="text-primary hover:underline text-xs"
                      >
                        {taskLink.label}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatTime(run.started_at)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatTime(endTime)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {calcDuration(run.started_at, endTime)}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs text-destructive">
                    {run.error || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
