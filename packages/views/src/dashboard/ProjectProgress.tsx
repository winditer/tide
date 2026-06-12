"use client";

import Link from "next/link";
import { Target } from "lucide-react";
import { useProjectProgress } from "@tide/core";

function clampPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  const pct = (completed / total) * 100;
  if (Number.isNaN(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function ProjectProgress() {
  const { data, isLoading, isError } = useProjectProgress(8);
  const projects = data ?? [];

  return (
    <section className="rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            项目进度
          </h2>
        </div>
        <Link
          href="/work-items"
          className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          全部 →
        </Link>
      </header>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-gray-400">加载中...</div>
      ) : isError ? (
        <div className="py-6 text-center text-sm text-red-500">加载失败</div>
      ) : projects.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">
          暂无项目工作项数据
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((p) => {
            const percent = clampPercent(p.completed, p.total);
            const isDone = percent >= 100;
            return (
              <Link
                key={p.id}
                href={`/work-items?project=${encodeURIComponent(p.id)}`}
                className="group block rounded-lg border border-gray-200/60 bg-white/60 p-3 transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-gray-900 group-hover:text-indigo-700">
                    {p.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {p.completed}/{p.total}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isDone
                        ? "bg-emerald-500"
                        : "bg-gradient-to-r from-indigo-400 to-indigo-500"
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{percent}%</span>
                  {isDone && (
                    <span className="font-medium text-emerald-600">已完成</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
