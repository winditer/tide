"use client";

import Link from "next/link";
import { CalendarClock, Clock } from "lucide-react";
import { useUpcomingSchedules } from "@tide/core";
import type { UpcomingSchedule } from "@tide/core";
import { formatAbsoluteTime, formatRelativeTime } from "./format-time";

const TYPE_LABEL: Record<string, string> = {
  cron: "Cron",
  interval: "Interval",
  date: "一次",
};

function isUrgent(schedule: UpcomingSchedule): boolean {
  if (!schedule.next_run_at) return false;
  const ts = new Date(schedule.next_run_at).getTime();
  if (Number.isNaN(ts)) return false;
  const diff = ts - Date.now();
  return diff > 0 && diff <= 60 * 60 * 1000; // 1 小时内
}

export function UpcomingSchedules() {
  const { data, isLoading, isError } = useUpcomingSchedules(5);
  const items = data ?? [];

  return (
    <section className="rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            即将执行
          </h2>
        </div>
        <Link
          href="/schedules"
          className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          全部 →
        </Link>
      </header>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-gray-400">加载中...</div>
      ) : isError ? (
        <div className="py-6 text-center text-sm text-red-500">加载失败</div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">
          暂无调度计划
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((s) => {
            const urgent = isUrgent(s);
            const type = s.schedule_type || "";
            return (
              <li key={s.id}>
                <Link
                  href={`/schedules/${s.id}`}
                  className={`group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
                    urgent
                      ? "bg-orange-50/70 hover:bg-orange-100/70"
                      : "hover:bg-indigo-50/60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={`truncate text-sm font-medium ${
                          urgent
                            ? "text-orange-700"
                            : "text-gray-900 group-hover:text-indigo-700"
                        }`}
                      >
                        {s.name}
                      </p>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                          urgent
                            ? "bg-orange-200/70 text-orange-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {TYPE_LABEL[type] ?? type}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                      <Clock
                        className={`h-3 w-3 ${
                          urgent ? "text-orange-500" : "text-gray-400"
                        }`}
                      />
                      <span
                        className={urgent ? "text-orange-600" : "text-gray-500"}
                        title={formatAbsoluteTime(s.next_run_at)}
                      >
                        {formatRelativeTime(s.next_run_at, {
                          fallback: "未排定",
                        })}
                      </span>
                      {urgent && (
                        <span className="rounded bg-orange-500/90 px-1 py-px text-[10px] font-medium text-white">
                          即将
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
