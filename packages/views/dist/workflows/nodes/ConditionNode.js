"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { statusTone } from "../node-tones";
const OP_LABEL = {
    eq: "==",
    equals: "==",
    ne: "≠",
    not_equals: "≠",
    gt: ">",
    lt: "<",
    gte: "≥",
    lte: "≤",
    contains: "⊃",
    not_contains: "⊅",
};
function ConditionNodeImpl({ data, selected }) {
    var _a, _b, _c;
    const d = (_a = data) !== null && _a !== void 0 ? _a : {};
    const status = d.runStatus;
    const t = statusTone(status);
    const label = String((_b = d.label) !== null && _b !== void 0 ? _b : "Condition");
    const field = d.field ? String(d.field) : "—";
    const operator = d.operator ? String(d.operator) : "eq";
    const value = d.value !== undefined ? String(d.value) : "—";
    return (_jsxs("div", { className: [
            "group relative select-none",
            "transition-transform duration-150",
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        ].join(" "), style: { width: 220, height: 140 }, children: [_jsx("div", { className: [
                    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
                    "h-[110px] w-[110px] border-2 bg-amber-50",
                    t.border,
                    t.shadow,
                ].join(" ") }), _jsxs("div", { className: "absolute inset-0 flex flex-col items-center justify-center px-6 text-center", children: [_jsxs("div", { className: `mb-1 px-2 py-[1px] font-mono text-[9px] tracking-[0.25em] ${t.accent} text-white ${t.pulse}`, children: ["\u25C6 COND \u00B7 ", t.label] }), _jsx("div", { className: "text-[12px] font-bold text-zinc-900", children: label }), _jsxs("div", { className: "mt-0.5 max-w-[180px] truncate font-mono text-[10px] text-amber-900", children: [field, " ", (_c = OP_LABEL[operator]) !== null && _c !== void 0 ? _c : operator, " ", value] })] }), _jsx(Handle, { type: "target", position: Position.Top, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}` }), _jsx(Handle, { id: "yes", type: "source", position: Position.Bottom, style: { left: "30%" }, className: "!h-2.5 !w-2.5 !rounded-none !border-0 !bg-emerald-600" }), _jsx(Handle, { id: "no", type: "source", position: Position.Bottom, style: { left: "70%" }, className: "!h-2.5 !w-2.5 !rounded-none !border-0 !bg-rose-600" }), _jsx("div", { className: "pointer-events-none absolute bottom-[-2px] left-[20%] font-mono text-[9px] tracking-widest text-emerald-700", children: "YES" }), _jsx("div", { className: "pointer-events-none absolute bottom-[-2px] right-[20%] font-mono text-[9px] tracking-widest text-rose-700", children: "NO" })] }));
}
export const ConditionNode = memo(ConditionNodeImpl);
//# sourceMappingURL=ConditionNode.js.map