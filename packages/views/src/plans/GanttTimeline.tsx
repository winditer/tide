"use client";

import { useMemo } from "react";
import dayjs from "dayjs";
import { usePlanTimeline } from "@tide/core";
import type { GanttItem } from "@tide/core";

const STATUS_FILL: Record<string, string> = {
  queued: "#cbd5e1",
  running: "#6366f1",
  review: "#8b5cf6",
  approved: "#10b981",
  completed: "#10b981",
  failed: "#ef4444",
  rejected: "#ef4444",
  stopped: "#71717a",
  cancelled: "#71717a",
};

const STATUS_HATCH: Record<string, boolean> = {
  queued: true,
  running: false,
};

interface GanttTimelineProps {
  planId: string;
  refetchInterval?: number;
}

function formatTime(d: dayjs.Dayjs) {
  return d.format("MM-DD HH:mm");
}

function durationLabel(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function GanttTimeline({ planId, refetchInterval }: GanttTimelineProps) {
  const { data, isLoading, isError } = usePlanTimeline(planId, {
    refetchInterval,
  });

  const computed = useMemo(() => {
    if (!data || data.length === 0) return null;
    const items = data;

    let minTime = dayjs();
    let maxTime = dayjs(0);
    let hasAny = false;

    for (const it of items) {
      if (it.start_time) {
        const t = dayjs(it.start_time);
        if (!hasAny || t.isBefore(minTime)) minTime = t;
        hasAny = true;
      }
      const endRef = it.end_time ?? it.start_time;
      if (endRef) {
        const t = dayjs(endRef);
        if (!hasAny || t.isAfter(maxTime)) maxTime = t;
        hasAny = true;
      }
    }

    if (!hasAny) {
      const now = dayjs();
      minTime = now.subtract(1, "minute");
      maxTime = now;
    }

    if (!maxTime.isAfter(minTime)) {
      maxTime = minTime.add(1, "minute");
    }

    const totalMs = Math.max(1, maxTime.diff(minTime));
    return { items, minTime, maxTime, totalMs };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center font-mono text-xs tracking-widest text-zinc-500">
        ◐ LOADING TIMELINE…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-64 items-center justify-center font-mono text-xs text-rose-600">
        ✕ TIMELINE LOAD FAILED
      </div>
    );
  }
  if (!computed) {
    return (
      <div className="flex h-64 items-center justify-center font-mono text-xs tracking-widest text-zinc-500">
        ◇ NO TIMELINE DATA
      </div>
    );
  }

  const { items, minTime, maxTime, totalMs } = computed;

  // Build tick marks
  const tickCount = 6;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const t = minTime.add((totalMs * i) / tickCount, "millisecond");
    return { pct: (i / tickCount) * 100, label: formatTime(t) };
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-card shadow-card">
      {/* Header strip */}
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Gantt · Timeline
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Span · {durationLabel(totalMs)}
        </span>
      </div>

      <div className="grid grid-cols-[260px_1fr] divide-x divide-border/50">
        {/* Left meta column */}
        <div>
          <div className="border-b border-border/50 bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Task
          </div>
          {items.map((it) => (
            <div
              key={it.task_id}
              className="flex items-center gap-2 border-b border-border/40 px-4 py-2"
              style={{ height: 44 }}
            >
              <span className="font-mono text-[10px] text-muted-foreground/70">
                P{it.phase}
              </span>
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: STATUS_FILL[it.status] ?? STATUS_FILL.queued,
                }}
              />
              <span className="truncate text-[12px] font-medium text-foreground">
                {it.title || it.task_id.slice(0, 8)}
              </span>
              {it.agent_id && (
                <span className="ml-auto rounded-md border border-border/60 bg-muted/40 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {it.agent_id}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Right timeline */}
        <div className="relative overflow-hidden">
          {/* Tick header */}
          <div className="relative border-b border-border/50 bg-muted/30 px-0 py-2">
            <div className="relative h-4">
              {ticks.map((t, i) => (
                <span
                  key={i}
                  className="absolute -translate-x-1/2 font-mono text-[9px] tracking-wider text-muted-foreground"
                  style={{ left: `${t.pct}%`, top: 0 }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {/* Bars */}
          <div className="relative">
            {/* Vertical grid lines */}
            <div className="pointer-events-none absolute inset-0">
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full border-l border-dashed border-border/40"
                  style={{ left: `${t.pct}%` }}
                />
              ))}
            </div>

            {items.map((it) => (
              <GanttRow
                key={it.task_id}
                item={it}
                minTime={minTime}
                maxTime={maxTime}
                totalMs={totalMs}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/50 bg-muted/20 px-4 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Legend
        </span>
        {Object.entries(STATUS_FILL).map(([k, color]) => (
          <span
            key={k}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: color }}
            />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

function GanttRow({
  item,
  minTime,
  maxTime,
  totalMs,
}: {
  item: GanttItem;
  minTime: dayjs.Dayjs;
  maxTime: dayjs.Dayjs;
  totalMs: number;
}) {
  const start = item.start_time ? dayjs(item.start_time) : null;
  const end = item.end_time
    ? dayjs(item.end_time)
    : item.status === "running" && start
      ? maxTime
      : start
        ? start.add(2, "second")
        : null;

  const fill = STATUS_FILL[item.status] ?? STATUS_FILL.queued;
  const hatched = STATUS_HATCH[item.status];

  let leftPct = 0;
  let widthPct = 0;
  if (start && end) {
    leftPct = Math.max(0, (start.diff(minTime) / totalMs) * 100);
    widthPct = Math.max(0.6, (end.diff(start) / totalMs) * 100);
  }

  const dur = item.duration_ms ?? (start && end ? end.diff(start) : null);

  return (
    <div
      className="relative border-b border-border/40"
      style={{ height: 44 }}
    >
      {/* Phase row striping */}
      <div className="absolute inset-0 bg-muted/10" />

      {start && end ? (
        <div
          className="group absolute top-1/2 -translate-y-1/2"
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            minWidth: 6,
          }}
        >
          <div
            className={[
              "relative h-5 rounded-md border border-black/5 shadow-sm",
              item.status === "running" ? "animate-pulse" : "",
            ].join(" ")}
            style={{
              background: hatched
                ? `repeating-linear-gradient(45deg, ${fill} 0 4px, rgba(0,0,0,0.05) 4px 6px)`
                : fill,
            }}
          >
            <div className="absolute inset-y-0 right-1.5 hidden items-center font-mono text-[9px] text-white group-hover:flex">
              {dur != null ? durationLabel(dur) : ""}
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-y-0 left-2 flex items-center font-mono text-[10px] tracking-widest text-muted-foreground/70">
          ◇ NOT STARTED
        </div>
      )}
    </div>
  );
}
