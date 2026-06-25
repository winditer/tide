"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRouter } from "next/navigation";
const STATUS_TONE = {
    pending: {
        label: "等待",
        bar: "bg-zinc-400",
        dot: "bg-zinc-400",
    },
    running: {
        label: "运行中",
        bar: "bg-sky-500",
        dot: "bg-sky-500",
    },
    completed: {
        label: "完成",
        bar: "bg-emerald-600",
        dot: "bg-emerald-600",
    },
    failed: {
        label: "失败",
        bar: "bg-rose-600",
        dot: "bg-rose-600",
    },
    cancelled: {
        label: "已取消",
        bar: "bg-zinc-500",
        dot: "bg-zinc-500",
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
    return (_jsxs("div", { className: "overflow-hidden bg-card rounded-xl shadow-card border border-border/50", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border/50 px-4 py-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block h-2 w-2 rounded-full bg-amber-500" }), _jsx("span", { className: "text-xs font-medium text-foreground", children: "\u8FD0\u884C\u5386\u53F2" })] }), _jsxs("span", { className: "text-[10px] text-muted-foreground", children: [runs.length, " \u6761\u8BB0\u5F55"] })] }), isLoading ? (_jsx("div", { className: "px-4 py-8 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" })) : runs.length === 0 ? (_jsxs("div", { className: "px-4 py-12 text-center", children: [_jsx("div", { className: "text-xs font-medium text-muted-foreground", children: "\u6682\u65E0\u8FD0\u884C\u8BB0\u5F55" }), _jsx("div", { className: "mt-2 text-xs text-muted-foreground", children: "\u70B9\u51FB\u300C\u8FD0\u884C\u300D\u6309\u94AE\u89E6\u53D1\u9996\u6B21\u6267\u884C" })] })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-border/50 bg-muted/30", children: [_jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u72B6\u6001" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u8FD0\u884C ID" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u5F00\u59CB\u65F6\u95F4" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u7ED3\u675F\u65F6\u95F4" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u8017\u65F6" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u8282\u70B9" })] }) }), _jsx("tbody", { className: "divide-y divide-border/50", children: runs.map((r) => {
                                var _a, _b, _c, _d, _e;
                                const tone = (_a = STATUS_TONE[r.status]) !== null && _a !== void 0 ? _a : STATUS_TONE.pending;
                                const total = (_c = (_b = r.node_runs) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0;
                                const done = (_e = (_d = r.node_runs) === null || _d === void 0 ? void 0 : _d.filter((n) => n.status === "completed").length) !== null && _e !== void 0 ? _e : 0;
                                return (_jsxs("tr", { className: "cursor-pointer transition-colors hover:bg-muted/30", onClick: () => router.push(`/workflows/${workflowId}/runs/${r.id}`), children: [_jsx("td", { className: "px-4 py-2.5", children: _jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium", children: [_jsx("span", { className: `h-1.5 w-1.5 rounded-full ${tone.dot}` }), tone.label] }) }), _jsx("td", { className: "px-4 py-2.5 font-mono text-xs text-muted-foreground", children: r.id.slice(0, 12) }), _jsx("td", { className: "px-4 py-2.5 text-xs text-muted-foreground", children: formatTime(r.started_at) }), _jsx("td", { className: "px-4 py-2.5 text-xs text-muted-foreground", children: formatTime(r.finished_at) }), _jsx("td", { className: "px-4 py-2.5 font-mono text-xs text-foreground", children: formatDuration(r.started_at, r.finished_at) }), _jsx("td", { className: "px-4 py-2.5", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "text-xs text-muted-foreground", children: [done, "/", total] }), _jsx("div", { className: "h-1.5 w-20 rounded-full bg-muted", children: _jsx("div", { className: `h-full rounded-full ${tone.bar}`, style: {
                                                                width: total
                                                                    ? `${Math.min(100, Math.round((done / total) * 100))}%`
                                                                    : "0%",
                                                            } }) })] }) })] }, r.id));
                            }) })] }) }))] }));
}
//# sourceMappingURL=RunHistory.js.map