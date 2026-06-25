"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import dayjs from "dayjs";
import { usePlanTimeline } from "@tide/core";
const STATUS_FILL = {
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
const STATUS_HATCH = {
    queued: true,
    running: false,
};
function formatTime(d) {
    return d.format("MM-DD HH:mm");
}
function durationLabel(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
        return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}
export function GanttTimeline({ planId, refetchInterval }) {
    const { data, isLoading, isError } = usePlanTimeline(planId, {
        refetchInterval,
    });
    const computed = useMemo(() => {
        var _a;
        if (!data || data.length === 0)
            return null;
        const items = data;
        let minTime = dayjs();
        let maxTime = dayjs(0);
        let hasAny = false;
        for (const it of items) {
            if (it.start_time) {
                const t = dayjs(it.start_time);
                if (!hasAny || t.isBefore(minTime))
                    minTime = t;
                hasAny = true;
            }
            const endRef = (_a = it.end_time) !== null && _a !== void 0 ? _a : it.start_time;
            if (endRef) {
                const t = dayjs(endRef);
                if (!hasAny || t.isAfter(maxTime))
                    maxTime = t;
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
        return (_jsx("div", { className: "flex h-64 items-center justify-center font-mono text-xs tracking-widest text-zinc-500", children: "\u25D0 LOADING TIMELINE\u2026" }));
    }
    if (isError) {
        return (_jsx("div", { className: "flex h-64 items-center justify-center font-mono text-xs text-rose-600", children: "\u2715 TIMELINE LOAD FAILED" }));
    }
    if (!computed) {
        return (_jsx("div", { className: "flex h-64 items-center justify-center font-mono text-xs tracking-widest text-zinc-500", children: "\u25C7 NO TIMELINE DATA" }));
    }
    const { items, minTime, maxTime, totalMs } = computed;
    // Build tick marks
    const tickCount = 6;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
        const t = minTime.add((totalMs * i) / tickCount, "millisecond");
        return { pct: (i / tickCount) * 100, label: formatTime(t) };
    });
    return (_jsxs("div", { className: "overflow-hidden rounded-xl border border-border/50 bg-card shadow-card", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-2.5", children: [_jsx("span", { className: "text-xs font-medium uppercase tracking-wider text-muted-foreground", children: "Gantt \u00B7 Timeline" }), _jsxs("span", { className: "font-mono text-[10px] uppercase tracking-widest text-muted-foreground", children: ["Span \u00B7 ", durationLabel(totalMs)] })] }), _jsxs("div", { className: "grid grid-cols-[260px_1fr] divide-x divide-border/50", children: [_jsxs("div", { children: [_jsx("div", { className: "border-b border-border/50 bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground", children: "Task" }), items.map((it) => {
                                var _a;
                                return (_jsxs("div", { className: "flex items-center gap-2 border-b border-border/40 px-4 py-2", style: { height: 44 }, children: [_jsxs("span", { className: "font-mono text-[10px] text-muted-foreground/70", children: ["P", it.phase] }), _jsx("span", { className: "inline-block h-2 w-2 shrink-0 rounded-full", style: {
                                                background: (_a = STATUS_FILL[it.status]) !== null && _a !== void 0 ? _a : STATUS_FILL.queued,
                                            } }), _jsx("span", { className: "truncate text-[12px] font-medium text-foreground", children: it.title || it.task_id.slice(0, 8) }), it.agent_id && (_jsx("span", { className: "ml-auto rounded-md border border-border/60 bg-muted/40 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-muted-foreground", children: it.agent_id }))] }, it.task_id));
                            })] }), _jsxs("div", { className: "relative overflow-hidden", children: [_jsx("div", { className: "relative border-b border-border/50 bg-muted/30 px-0 py-2", children: _jsx("div", { className: "relative h-4", children: ticks.map((t, i) => (_jsx("span", { className: "absolute -translate-x-1/2 font-mono text-[9px] tracking-wider text-muted-foreground", style: { left: `${t.pct}%`, top: 0 }, children: t.label }, i))) }) }), _jsxs("div", { className: "relative", children: [_jsx("div", { className: "pointer-events-none absolute inset-0", children: ticks.map((t, i) => (_jsx("div", { className: "absolute top-0 h-full border-l border-dashed border-border/40", style: { left: `${t.pct}%` } }, i))) }), items.map((it) => (_jsx(GanttRow, { item: it, minTime: minTime, maxTime: maxTime, totalMs: totalMs }, it.task_id)))] })] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/50 bg-muted/20 px-4 py-2", children: [_jsx("span", { className: "text-[10px] font-medium uppercase tracking-wider text-muted-foreground", children: "Legend" }), Object.entries(STATUS_FILL).map(([k, color]) => (_jsxs("span", { className: "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground", children: [_jsx("span", { className: "inline-block h-2 w-3 rounded-sm", style: { background: color } }), k] }, k)))] })] }));
}
function GanttRow({ item, minTime, maxTime, totalMs, }) {
    var _a, _b;
    const start = item.start_time ? dayjs(item.start_time) : null;
    const end = item.end_time
        ? dayjs(item.end_time)
        : item.status === "running" && start
            ? maxTime
            : start
                ? start.add(2, "second")
                : null;
    const fill = (_a = STATUS_FILL[item.status]) !== null && _a !== void 0 ? _a : STATUS_FILL.queued;
    const hatched = STATUS_HATCH[item.status];
    let leftPct = 0;
    let widthPct = 0;
    if (start && end) {
        leftPct = Math.max(0, (start.diff(minTime) / totalMs) * 100);
        widthPct = Math.max(0.6, (end.diff(start) / totalMs) * 100);
    }
    const dur = (_b = item.duration_ms) !== null && _b !== void 0 ? _b : (start && end ? end.diff(start) : null);
    return (_jsxs("div", { className: "relative border-b border-border/40", style: { height: 44 }, children: [_jsx("div", { className: "absolute inset-0 bg-muted/10" }), start && end ? (_jsx("div", { className: "group absolute top-1/2 -translate-y-1/2", style: {
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    minWidth: 6,
                }, children: _jsx("div", { className: [
                        "relative h-5 rounded-md border border-black/5 shadow-sm",
                        item.status === "running" ? "animate-pulse" : "",
                    ].join(" "), style: {
                        background: hatched
                            ? `repeating-linear-gradient(45deg, ${fill} 0 4px, rgba(0,0,0,0.05) 4px 6px)`
                            : fill,
                    }, children: _jsx("div", { className: "absolute inset-y-0 right-1.5 hidden items-center font-mono text-[9px] text-white group-hover:flex", children: dur != null ? durationLabel(dur) : "" }) }) })) : (_jsx("div", { className: "absolute inset-y-0 left-2 flex items-center font-mono text-[10px] tracking-widest text-muted-foreground/70", children: "\u25C7 NOT STARTED" }))] }));
}
//# sourceMappingURL=GanttTimeline.js.map