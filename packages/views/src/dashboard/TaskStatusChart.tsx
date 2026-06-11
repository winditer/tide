"use client";

import { BarChart3 } from "lucide-react";
import { useTaskStatusDistribution } from "@tide/core";

interface StatusRow {
  key: string;
  label: string;
  barClass: string;
  textClass: string;
}

const STATUS_ROWS: StatusRow[] = [
  {
    key: "queued",
    label: "排队中",
    barClass: "bg-amber-400",
    textClass: "text-amber-700",
  },
  {
    key: "running",
    label: "运行中",
    barClass: "bg-indigo-500",
    textClass: "text-indigo-700",
  },
  {
    key: "review",
    label: "待审批",
    barClass: "bg-orange-400",
    textClass: "text-orange-700",
  },
  {
    key: "completed",
    label: "已完成",
    barClass: "bg-emerald-500",
    textClass: "text-emerald-700",
  },
  {
    key: "failed",
    label: "失败",
    barClass: "bg-red-500",
    textClass: "text-red-700",
  },
  {
    key: "cancelled",
    label: "已取消",
    barClass: "bg-gray-400",
    textClass: "text-gray-700",
  },
];

export function TaskStatusChart() {
  const { data, isLoading, isError } = useTaskStatusDistribution();
  const distribution = data ?? null;

  const max =
    distribution
      ? Math.max(1, ...STATUS_ROWS.map((r) => distribution[r.key] ?? 0))
      : 1;
  const total =
    distribution
      ? STATUS_ROWS.reduce((sum, r) => sum + (distribution[r.key] ?? 0), 0)
      : 0;

  return (
    <section className="rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            任务状态分布
          </h2>
        </div>
        {distribution && (
          <span className="text-xs text-gray-400">共 {total}</span>
        )}
      </header>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
      ) : isError || !distribution ? (
        <div className="py-8 text-center text-sm text-red-500">加载失败</div>
      ) : total === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">暂无数据</div>
      ) : (
        <ul className="space-y-2.5">
          {STATUS_ROWS.map((row) => {
            const value = distribution[row.key] ?? 0;
            const ratio = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
            return (
              <li key={row.key} className="grid grid-cols-[64px_1fr_36px] items-center gap-3">
                <span className={`text-xs font-medium ${row.textClass}`}>
                  {row.label}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${row.barClass} transition-[width] duration-500 ease-out`}
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <span className="text-right font-mono text-xs tabular-nums text-gray-700">
                  {value}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
