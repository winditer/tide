"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRouter } from "next/navigation";
import { Button } from "@lark2codex/ui";
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
        return (_jsxs("div", { className: "border border-zinc-900 bg-white p-12 text-center shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]", children: [_jsx("div", { className: "font-mono text-[10px] tracking-[0.3em] text-zinc-500", children: "\u25C7 NO PLANS YET" }), _jsx("p", { className: "mt-3 text-sm text-zinc-700", children: "Create your first multi-task plan with dependency graph & approvals." }), onCreate && (_jsx(Button, { className: "mt-4", onClick: onCreate, children: "\u25B6 \u65B0\u5EFA Plan" }))] }));
    }
    return (_jsx("div", { className: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3", children: plans.map((plan, idx) => {
            var _a;
            const tone = (_a = STATUS_TONE[plan.status]) !== null && _a !== void 0 ? _a : { dot: "bg-slate-400", label: plan.status };
            const taskCount = parseTaskCount(plan.definition);
            return (_jsxs("button", { onClick: () => router.push(`/plans/${plan.id}`), className: "group relative overflow-hidden border border-zinc-900 bg-white text-left shadow-[6px_6px_0_0_rgba(24,24,27,0.92)] transition-transform duration-150 hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_rgba(24,24,27,0.92)]", children: [_jsxs("div", { className: `flex items-center justify-between ${tone.dot} px-3 py-1.5 text-white`, children: [_jsxs("span", { className: "font-mono text-[10px] tracking-[0.25em]", children: ["PLAN \u00B7 ", tone.label] }), _jsx("span", { className: "font-mono text-[10px]", children: String(idx + 1).padStart(3, "0") })] }), _jsxs("div", { className: "p-4", children: [_jsxs("div", { className: "mb-3 font-mono text-[18px] font-bold leading-none tracking-tight text-zinc-900", children: [plan.id.slice(0, 8), _jsx("span", { className: "text-zinc-300", children: "\u00B7" }), _jsx("span", { className: "text-[12px] font-medium text-zinc-500", children: plan.id.slice(8, 14) })] }), _jsxs("div", { className: "flex items-center gap-4 border-y border-dashed border-zinc-300 py-3 font-mono text-[11px]", children: [_jsx(Stat, { label: "TASKS", value: String(taskCount) }), _jsx(Stat, { label: "PARALLEL", value: String(plan.max_parallel) }), _jsx(Stat, { label: "MODEL", value: plan.model || "—" })] }), _jsxs("div", { className: "mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]", children: [_jsx("div", { className: "text-zinc-500", children: "CREATED" }), _jsx("div", { className: "text-right text-zinc-800", children: formatTime(plan.created_at) }), _jsx("div", { className: "text-zinc-500", children: "FINISHED" }), _jsx("div", { className: "text-right text-zinc-800", children: formatTime(plan.completed_at) })] }), _jsxs("div", { className: "mt-4 flex items-center justify-between font-mono text-[10px] tracking-widest text-zinc-700", children: [_jsx("span", { className: "opacity-0 transition-opacity group-hover:opacity-100", children: "\u2192 INSPECT DAG" }), _jsx("span", { children: plan.workspace_id || "default" })] })] })] }, plan.id));
        }) }));
}
function Stat({ label, value }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "text-[9px] tracking-widest text-zinc-500", children: label }), _jsx("div", { className: "text-[13px] font-bold text-zinc-900", children: value })] }));
}
//# sourceMappingURL=PlanList.js.map