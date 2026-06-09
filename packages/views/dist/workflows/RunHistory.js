"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRouter } from "next/navigation";
const STATUS_TONE = {
    pending: {
        label: "PENDING",
        bar: "bg-zinc-400",
        chip: "bg-zinc-100 text-zinc-700 border-zinc-400",
        glyph: "◇",
    },
    running: {
        label: "RUNNING",
        bar: "bg-sky-500",
        chip: "bg-sky-100 text-sky-800 border-sky-500",
        glyph: "▲",
    },
    completed: {
        label: "DONE",
        bar: "bg-emerald-600",
        chip: "bg-emerald-100 text-emerald-800 border-emerald-600",
        glyph: "■",
    },
    failed: {
        label: "FAILED",
        bar: "bg-rose-600",
        chip: "bg-rose-100 text-rose-800 border-rose-600",
        glyph: "✕",
    },
    cancelled: {
        label: "CANCELLED",
        bar: "bg-zinc-500",
        chip: "bg-zinc-100 text-zinc-700 border-zinc-400",
        glyph: "□",
    },
};
function formatTime(iso) {
    if (!iso)
        return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }
    catch (_a) {
        return iso;
    }
}
function formatDuration(start, end) {
    if (!start)
        return "—";
    const a = new Date(start).getTime();
    const b = end ? new Date(end).getTime() : Date.now();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
        return "—";
    const ms = b - a;
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
        return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}
export function RunHistory({ workflowId, runs, isLoading }) {
    const router = useRouter();
    return (_jsxs("div", { className: "overflow-hidden border-2 border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]", children: [_jsxs("div", { className: "flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-4 py-2.5 text-white", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block h-2 w-2 bg-amber-400" }), _jsx("span", { className: "font-mono text-[11px] tracking-[0.3em]", children: "\u25F4 RUN HISTORY" })] }), _jsxs("span", { className: "font-mono text-[10px] tracking-widest text-zinc-400", children: [runs.length, " ENTRIES"] })] }), isLoading ? (_jsx("div", { className: "px-4 py-8 text-center font-mono text-xs tracking-widest text-zinc-500", children: "\u25D0 LOADING\u2026" })) : runs.length === 0 ? (_jsxs("div", { className: "px-4 py-12 text-center", children: [_jsx("div", { className: "font-mono text-[11px] tracking-[0.3em] text-zinc-500", children: "\u25C7 NO RUNS YET" }), _jsx("div", { className: "mt-2 text-xs text-zinc-500", children: "\u70B9\u51FB\u300C\u8FD0\u884C\u300D\u6309\u94AE\u89E6\u53D1\u9996\u6B21\u6267\u884C" })] })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b-2 border-zinc-900 bg-zinc-50", children: [_jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "STATUS" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "RUN_ID" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "STARTED" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "FINISHED" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "DURATION" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "NODES" })] }) }), _jsx("tbody", { children: runs.map((r) => {
                                var _a, _b, _c, _d, _e;
                                const tone = (_a = STATUS_TONE[r.status]) !== null && _a !== void 0 ? _a : STATUS_TONE.pending;
                                const total = (_c = (_b = r.node_runs) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0;
                                const done = (_e = (_d = r.node_runs) === null || _d === void 0 ? void 0 : _d.filter((n) => n.status === "completed").length) !== null && _e !== void 0 ? _e : 0;
                                return (_jsxs("tr", { className: "cursor-pointer border-b border-zinc-200 transition-colors hover:bg-zinc-50", onClick: () => router.push(`/workflows/${workflowId}/runs/${r.id}`), children: [_jsx("td", { className: "px-3 py-2.5", children: _jsxs("span", { className: `inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[10px] tracking-[0.2em] ${tone.chip}`, children: [_jsx("span", { children: tone.glyph }), _jsx("span", { children: tone.label })] }) }), _jsx("td", { className: "px-3 py-2.5 font-mono text-[11px] text-zinc-800", children: r.id.slice(0, 12) }), _jsx("td", { className: "px-3 py-2.5 font-mono text-[11px] text-zinc-700", children: formatTime(r.started_at) }), _jsx("td", { className: "px-3 py-2.5 font-mono text-[11px] text-zinc-700", children: formatTime(r.finished_at) }), _jsx("td", { className: "px-3 py-2.5 font-mono text-[11px] text-zinc-900", children: formatDuration(r.started_at, r.finished_at) }), _jsx("td", { className: "px-3 py-2.5", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "font-mono text-[11px] text-zinc-700", children: [done, "/", total] }), _jsx("div", { className: "h-1.5 w-20 border border-zinc-300 bg-zinc-100", children: _jsx("div", { className: `h-full ${tone.bar}`, style: {
                                                                width: total
                                                                    ? `${Math.min(100, Math.round((done / total) * 100))}%`
                                                                    : "0%",
                                                            } }) })] }) })] }, r.id));
                            }) })] }) }))] }));
}
//# sourceMappingURL=RunHistory.js.map