"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRouter } from "next/navigation";
import { Button } from "@tide/ui";
const STATUS_TONE = {
    active: { dot: "bg-amber-500", label: "ACTIVE" },
    running: { dot: "bg-amber-500", label: "RUNNING" },
    completed: { dot: "bg-emerald-600", label: "COMPLETED" },
    stopped: { dot: "bg-zinc-500", label: "STOPPED" },
    failed: { dot: "bg-rose-600", label: "FAILED" },
};
function formatTime(iso) {
    if (!iso)
        return "—";
    try {
        const d = new Date(iso);
        return d.toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    catch (_a) {
        return iso;
    }
}
function parseTaskCount(definition) {
    if (!definition)
        return 0;
    try {
        const obj = JSON.parse(definition);
        if (Array.isArray(obj === null || obj === void 0 ? void 0 : obj.tasks))
            return obj.tasks.length;
    }
    catch (_a) {
        // ignore
    }
    return 0;
}
export function PlanList({ plans, onCreate }) {
    const router = useRouter();
    if (plans.length === 0) {
        return (_jsxs("div", { className: "bg-card rounded-xl p-12 text-center", children: [_jsx("div", { className: "text-xs font-medium text-muted-foreground", children: "\u6682\u65E0 Plan" }), _jsx("p", { className: "mt-3 text-sm text-muted-foreground", children: "\u521B\u5EFA\u4F60\u7684\u7B2C\u4E00\u4E2A\u591A\u4EFB\u52A1\u8BA1\u5212\uFF0C\u652F\u6301\u4F9D\u8D56\u56FE\u4E0E\u5BA1\u6279\u3002" }), onCreate && (_jsx(Button, { className: "mt-4", onClick: onCreate, children: "+ \u65B0\u5EFA Plan" }))] }));
    }
    return (_jsx("div", { className: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 p-4", children: plans.map((plan) => {
            var _a;
            const tone = (_a = STATUS_TONE[plan.status]) !== null && _a !== void 0 ? _a : { dot: "bg-slate-400", label: plan.status };
            const taskCount = parseTaskCount(plan.definition);
            return (_jsxs("button", { onClick: () => router.push(`/plans/${plan.id}`), className: "group relative overflow-hidden bg-card rounded-lg p-4 shadow-sm hover:shadow-card-hover transition-smooth border border-border/50 text-left", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsx("span", { className: "font-mono text-lg font-semibold tracking-tight text-foreground", children: plan.id.slice(0, 8) }), _jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wider", children: [_jsx("span", { className: `inline-block h-2 w-2 rounded-full ${tone.dot}` }), tone.label] })] }), _jsxs("div", { className: "flex items-center gap-4 border-t border-border/50 pt-3 text-[11px]", children: [_jsx(Stat, { label: "\u4EFB\u52A1", value: String(taskCount) }), _jsx(Stat, { label: "\u5E76\u53D1", value: String(plan.max_parallel) }), _jsx(Stat, { label: "\u6A21\u578B", value: plan.model || "—" })] }), _jsxs("div", { className: "mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]", children: [_jsx("div", { className: "text-muted-foreground", children: "\u521B\u5EFA" }), _jsx("div", { className: "text-right text-foreground", children: formatTime(plan.created_at) }), _jsx("div", { className: "text-muted-foreground", children: "\u5B8C\u6210" }), _jsx("div", { className: "text-right text-foreground", children: formatTime(plan.completed_at) })] }), _jsxs("div", { className: "mt-3 flex items-center justify-between text-[10px] text-muted-foreground", children: [_jsx("span", { className: "opacity-0 transition-opacity group-hover:opacity-100", children: "\u67E5\u770B\u8BE6\u60C5 \u2192" }), _jsx("span", { children: plan.workspace_id || "default" })] })] }, plan.id));
        }) }));
}
function Stat({ label, value }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-muted-foreground", children: label }), _jsx("div", { className: "text-[13px] font-semibold text-foreground", children: value })] }));
}
//# sourceMappingURL=PlanList.js.map