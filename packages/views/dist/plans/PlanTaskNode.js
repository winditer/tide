"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
const STATUS_TONE = {
    queued: {
        ring: "ring-slate-300",
        surface: "bg-white",
        accent: "bg-slate-400",
        pulse: "",
        label: "QUEUED",
        glyph: "◇",
    },
    running: {
        ring: "ring-amber-400",
        surface: "bg-amber-50",
        accent: "bg-amber-500",
        pulse: "animate-pulse",
        label: "RUNNING",
        glyph: "▲",
    },
    review: {
        ring: "ring-violet-400",
        surface: "bg-violet-50",
        accent: "bg-violet-500",
        pulse: "",
        label: "REVIEW",
        glyph: "◑",
    },
    approved: {
        ring: "ring-emerald-400",
        surface: "bg-emerald-50",
        accent: "bg-emerald-500",
        pulse: "",
        label: "APPROVED",
        glyph: "✓",
    },
    completed: {
        ring: "ring-emerald-500",
        surface: "bg-emerald-50",
        accent: "bg-emerald-600",
        pulse: "",
        label: "DONE",
        glyph: "■",
    },
    failed: {
        ring: "ring-rose-500",
        surface: "bg-rose-50",
        accent: "bg-rose-600",
        pulse: "",
        label: "FAILED",
        glyph: "✕",
    },
    rejected: {
        ring: "ring-rose-400",
        surface: "bg-rose-50",
        accent: "bg-rose-500",
        pulse: "",
        label: "REJECTED",
        glyph: "✕",
    },
    stopped: {
        ring: "ring-zinc-400",
        surface: "bg-zinc-50",
        accent: "bg-zinc-500",
        pulse: "",
        label: "STOPPED",
        glyph: "□",
    },
    cancelled: {
        ring: "ring-zinc-400",
        surface: "bg-zinc-50",
        accent: "bg-zinc-500",
        pulse: "",
        label: "CANCELLED",
        glyph: "□",
    },
};
function tone(status) {
    var _a;
    return (_a = STATUS_TONE[status]) !== null && _a !== void 0 ? _a : STATUS_TONE.queued;
}
function PlanTaskNodeImpl({ data, selected }) {
    var _a, _b, _c;
    const d = (data !== null && data !== void 0 ? data : {});
    const t = tone(String(d.status));
    const idx = (_a = d.taskIndex) !== null && _a !== void 0 ? _a : d.task_index;
    const phase = (_b = d.phase) !== null && _b !== void 0 ? _b : 0;
    const agent = (_c = d.agentId) !== null && _c !== void 0 ? _c : d.agent_id;
    return (_jsxs("div", { className: [
            "group relative w-[260px] select-none",
            "border border-zinc-900",
            "bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]",
            "transition-transform duration-150",
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        ].join(" "), children: [_jsxs("div", { className: `flex items-center justify-between px-3 py-1.5 ${t.accent} text-white ${t.pulse}`, children: [_jsx("span", { className: "font-mono text-[10px] tracking-[0.2em]", children: t.label }), _jsx("span", { className: "font-mono text-[11px]", children: t.glyph })] }), _jsxs("div", { className: `relative px-4 py-3 ${t.surface}`, children: [_jsxs("div", { className: "mb-2 flex items-center justify-between", children: [_jsxs("span", { className: "font-mono text-[10px] tracking-widest text-zinc-500", children: [idx != null
                                        ? `#${String(idx).padStart(2, "0")}`
                                        : "#--", _jsx("span", { className: "mx-1.5 text-zinc-300", children: "/" }), _jsxs("span", { className: "text-zinc-700", children: ["PHASE ", phase] })] }), agent && (_jsx("span", { className: "rounded-sm border border-zinc-300 bg-white px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-zinc-700", children: agent }))] }), _jsx("div", { className: "text-[13px] font-semibold leading-snug text-zinc-900 line-clamp-3", children: d.title || "Untitled" }), _jsx("div", { className: "mt-2 font-mono text-[9px] tracking-widest text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100", children: "\u2192 CLICK TO INSPECT" })] }), _jsx(Handle, { type: "target", position: Position.Top, className: `!h-2 !w-2 !rounded-none !border-0 ${t.accent}` }), _jsx(Handle, { type: "source", position: Position.Bottom, className: `!h-2 !w-2 !rounded-none !border-0 ${t.accent}` })] }));
}
export const PlanTaskNode = memo(PlanTaskNodeImpl);
//# sourceMappingURL=PlanTaskNode.js.map