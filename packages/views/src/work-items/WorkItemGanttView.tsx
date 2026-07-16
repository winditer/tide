"use client";

import { useMemo, useState } from "react";
import type { WorkItem } from "@tide/core";

type Granularity = "day" | "week" | "month";

/** 基于工作项状态的甘特条形颜色 */
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-300 dark:bg-slate-500",
  in_progress: "bg-blue-400 dark:bg-blue-500",
  pending_approval: "bg-amber-400 dark:bg-amber-500",
  waiting: "bg-amber-300 dark:bg-amber-400",
  completed: "bg-emerald-400 dark:bg-emerald-500",
  failed: "bg-red-400 dark:bg-red-500",
  cancelled: "bg-orange-400 dark:bg-orange-500",
  closed: "bg-slate-400 dark:bg-slate-500",
};

const STATUS_COLORS_DEFAULT = "bg-slate-300 dark:bg-slate-500";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "日" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getMonthLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 生成时间刻度标签 */
function generateTicks(
  rangeStart: Date,
  rangeEnd: Date,
  granularity: Granularity,
): { label: string; offsetPercent: number }[] {
  const totalDays = diffDays(rangeStart, rangeEnd) || 1;
  const ticks: { label: string; offsetPercent: number }[] = [];

  if (granularity === "day") {
    let cur = new Date(rangeStart);
    while (cur <= rangeEnd) {
      const offset = (diffDays(rangeStart, cur) / totalDays) * 100;
      ticks.push({ label: `${cur.getMonth() + 1}/${cur.getDate()}`, offsetPercent: offset });
      cur = addDays(cur, 1);
    }
  } else if (granularity === "week") {
    let cur = new Date(rangeStart);
    // Align to Monday
    const day = cur.getDay();
    const alignOffset = day === 0 ? -6 : 1 - day;
    cur = addDays(cur, alignOffset);
    if (cur < rangeStart) cur = addDays(cur, 7);
    // Always start with rangeStart
    ticks.push({ label: getWeekLabel(rangeStart), offsetPercent: 0 });
    while (cur <= rangeEnd) {
      const offset = (diffDays(rangeStart, cur) / totalDays) * 100;
      if (offset > 0 && offset < 100) {
        ticks.push({ label: getWeekLabel(cur), offsetPercent: offset });
      }
      cur = addDays(cur, 7);
    }
  } else {
    // month
    let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    if (cur < rangeStart) {
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    // Always start with rangeStart
    ticks.push({ label: getMonthLabel(rangeStart), offsetPercent: 0 });
    while (cur <= rangeEnd) {
      const offset = (diffDays(rangeStart, cur) / totalDays) * 100;
      if (offset > 0 && offset < 100) {
        ticks.push({ label: getMonthLabel(cur), offsetPercent: offset });
      }
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  }

  return ticks;
}

interface WorkItemGanttViewProps {
  items: WorkItem[];
  onItemSelect?: (item: WorkItem) => void;
}

export function WorkItemGanttView({ items, onItemSelect }: WorkItemGanttViewProps) {
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Filter items that have planned dates and are not archived
  const scheduledItems = useMemo(
    () => items.filter((it) => !it.archived && (it.planned_start_date || it.planned_end_date)),
    [items],
  );

  // Compute time range
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (scheduledItems.length === 0) {
      const today = startOfDay(new Date());
      return { rangeStart: today, rangeEnd: addDays(today, 30) };
    }
    let minDate = Infinity;
    let maxDate = -Infinity;
    for (const it of scheduledItems) {
      const s = it.planned_start_date ? new Date(it.planned_start_date).getTime() : null;
      const e = it.planned_end_date ? new Date(it.planned_end_date).getTime() : null;
      if (s !== null && s < minDate) minDate = s;
      if (e !== null && e > maxDate) maxDate = e;
      if (s !== null && s > maxDate) maxDate = s;
      if (e !== null && e < minDate) minDate = e;
    }
    // Add padding
    const start = addDays(startOfDay(new Date(minDate)), -2);
    const end = addDays(startOfDay(new Date(maxDate)), 3);
    return { rangeStart: start, rangeEnd: end };
  }, [scheduledItems]);

  const totalDays = diffDays(rangeStart, rangeEnd) || 1;

  const ticks = useMemo(
    () => generateTicks(rangeStart, rangeEnd, granularity),
    [rangeStart, rangeEnd, granularity],
  );

  // If no items at all
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/40 py-16 text-center">
        <p className="text-sm text-muted-foreground">暂无工作项</p>
      </div>
    );
  }

  // If all items lack planned dates
  if (scheduledItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/40 py-16 text-center">
        <p className="text-sm text-muted-foreground">当前工作项均未设置计划时间</p>
        <p className="mt-1 text-xs text-muted-foreground">
          为工作项设置「计划开始/结束日期」后即可在甘特图中展示
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          共 {scheduledItems.length} 项有计划时间（{items.length} 项总计）
        </span>
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5">
          {GRANULARITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setGranularity(opt.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                granularity === opt.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Gantt body */}
      <div className="flex overflow-x-auto">
        {/* Left: title column */}
        <div className="w-[200px] min-w-[200px] border-r border-border/50">
          {/* Header spacer */}
          <div className="h-8 border-b border-border/50 bg-muted/20 px-3 flex items-center">
            <span className="text-xs font-medium text-muted-foreground">工作项</span>
          </div>
          {/* Items */}
          {scheduledItems.map((item) => (
            <div
              key={item.id}
              className="h-10 flex items-center px-3 border-b border-border/30 hover:bg-accent/30 cursor-pointer transition-colors"
              onClick={() => onItemSelect?.(item)}
              title={item.title}
            >
              <span className="text-sm truncate text-foreground">{item.title}</span>
            </div>
          ))}
        </div>

        {/* Right: timeline area */}
        <div className="flex-1 min-w-0">
          {/* Timeline header */}
          <div className="relative h-8 border-b border-border/50 bg-muted/20">
            {ticks.map((tick, i) => (
              <span
                key={i}
                className="absolute top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground whitespace-nowrap"
                style={{ left: `${tick.offsetPercent}%`, transform: `translateX(-50%) translateY(-50%)` }}
              >
                {tick.label}
              </span>
            ))}
          </div>

          {/* Bars */}
          {scheduledItems.map((item) => {
            const startDate = item.planned_start_date
              ? startOfDay(new Date(item.planned_start_date))
              : item.planned_end_date
                ? startOfDay(new Date(item.planned_end_date))
                : rangeStart;
            const endDate = item.planned_end_date
              ? startOfDay(new Date(item.planned_end_date))
              : item.planned_start_date
                ? addDays(startOfDay(new Date(item.planned_start_date)), 1)
                : addDays(rangeStart, 1);

            const leftDays = diffDays(rangeStart, startDate);
            const widthDays = diffDays(startDate, endDate) || 1;

            let leftPercent = (leftDays / totalDays) * 100;
            let widthPercent = (widthDays / totalDays) * 100;

            // Clamp
            if (leftPercent < 0) {
              widthPercent += leftPercent;
              leftPercent = 0;
            }
            if (leftPercent + widthPercent > 100) {
              widthPercent = 100 - leftPercent;
            }
            // Minimum visible width
            if (widthPercent < 2) widthPercent = 2;

            const colorClass = STATUS_COLORS[item.status ?? ""] ?? STATUS_COLORS_DEFAULT;
            const isHovered = hoveredId === item.id;

            return (
              <div
                key={item.id}
                className="relative h-10 border-b border-border/30"
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Grid lines */}
                <div className="absolute inset-0 pointer-events-none">
                  {ticks.map((tick, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 w-px bg-border/20"
                      style={{ left: `${tick.offsetPercent}%` }}
                    />
                  ))}
                </div>

                {/* Bar */}
                <div
                  className={`absolute top-2 h-6 rounded cursor-pointer transition-all ${colorClass} ${
                    isHovered ? "ring-2 ring-ring/50 scale-y-110" : ""
                  }`}
                  style={{
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                  }}
                  onClick={() => onItemSelect?.(item)}
                />

                {/* Tooltip */}
                {isHovered && (
                  <div className="absolute z-50 top-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md text-popover-foreground whitespace-nowrap"
                    style={{ left: `${leftPercent}%` }}
                  >
                    <p className="font-medium max-w-[240px] truncate">{item.title}</p>
                    <p className="text-muted-foreground mt-0.5">
                      {item.planned_start_date ? formatDate(new Date(item.planned_start_date)) : "未设置"}{" "}
                      → {item.planned_end_date ? formatDate(new Date(item.planned_end_date)) : "未设置"}
                    </p>
                    {item.assignee && (
                      <p className="text-muted-foreground mt-0.5">负责人: {item.assignee}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
