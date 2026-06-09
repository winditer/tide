"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { statusTone } from "../node-tones";
function ParallelNodeImpl({ data, selected }) {
    var _a, _b;
    const d = (_a = data) !== null && _a !== void 0 ? _a : {};
    const status = d.runStatus;
    const t = statusTone(status);
    const label = String((_b = d.label) !== null && _b !== void 0 ? _b : "Fork");
    return (_jsxs("div", { className: [
            "group relative select-none",
            "transition-transform duration-150",
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        ].join(" "), style: { width: 200, height: 120 }, children: [_jsx("div", { className: [
                    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
                    "h-[90px] w-[90px] border-2 bg-cyan-50",
                    t.border,
                    t.shadow,
                ].join(" ") }), _jsxs("div", { className: "absolute inset-0 flex flex-col items-center justify-center px-4 text-center", children: [_jsx("div", { className: `mb-1 px-2 py-[1px] font-mono text-[9px] tracking-[0.25em] ${t.accent} text-white ${t.pulse}`, children: "+ FORK" }), _jsx("div", { className: "text-2xl leading-none text-cyan-700", children: "\uFF0B" }), _jsx("div", { className: "mt-0.5 max-w-[140px] truncate text-[11px] font-bold text-zinc-900", children: label })] }), _jsx(Handle, { type: "target", position: Position.Top, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}` }), _jsx(Handle, { id: "b1", type: "source", position: Position.Bottom, style: { left: "20%" }, className: "!h-2.5 !w-2.5 !rounded-none !border-0 !bg-cyan-600" }), _jsx(Handle, { id: "b2", type: "source", position: Position.Bottom, style: { left: "50%" }, className: "!h-2.5 !w-2.5 !rounded-none !border-0 !bg-cyan-600" }), _jsx(Handle, { id: "b3", type: "source", position: Position.Bottom, style: { left: "80%" }, className: "!h-2.5 !w-2.5 !rounded-none !border-0 !bg-cyan-600" })] }));
}
export const ParallelNode = memo(ParallelNodeImpl);
//# sourceMappingURL=ParallelNode.js.map