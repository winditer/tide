"use client";

import { Badge } from "@tide/ui";
import type { ScheduleRun } from "@tide/core";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  success: "secondary",
  failed: "destructive",
  running: "default",
};

const STATUS_LABEL: Record<string, string> = {
  success: "成功",
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

function calcDuration(started: string, finished: string | null): string {
  if (!finished) return "进行中";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

interface ScheduleRunHistoryProps {
  runs: ScheduleRun[];
}

export function ScheduleRunHistory({ runs }: ScheduleRunHistoryProps) {
  if (runs.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        暂无执行记录
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-3 py-3 font-medium">状态</th>
            <th className="px-3 py-3 font-medium">开始时间</th>
            <th className="px-3 py-3 font-medium">结束时间</th>
            <th className="px-3 py-3 font-medium">耗时</th>
            <th className="px-3 py-3 font-medium">错误信息</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b">
              <td className="px-3 py-3">
                <Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>
                  {STATUS_LABEL[run.status] ?? run.status}
                </Badge>
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {formatTime(run.started_at)}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {formatTime(run.finished_at)}
              </td>
              <td className="px-3 py-3 font-mono text-xs">
                {calcDuration(run.started_at, run.finished_at)}
              </td>
              <td className="max-w-[200px] truncate px-3 py-3 text-xs text-destructive">
                {run.error || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
