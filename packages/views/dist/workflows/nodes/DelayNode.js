"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { statusTone } from "../node-tones";
function formatSeconds(s) {
    if (!Number.isFinite(s) || s <= 0)
        return "0s";
    if (s < 60)
        return `${s}s`;
    if (s < 3600)
        return `${(s / 60).toFixed(1)}m`;
    return `${(s / 3600).toFixed(1)}h`;
}
function DelayNodeImpl({ data, selected }) {
    var _a, _b, _c;
    const d = (_a = data) !== null && _a !== void 0 ? _a : {};
    const status = d.runStatus;
    const t = statusTone(status);
    const label = String((_b = d.label) !== null && _b !== void 0 ? _b : "Delay");
    const seconds = Number((_c = d.seconds) !== null && _c !== void 0 ? _c : 0);
    return (_jsxs("div", { className: [
            "group relative w-[200px] select-none border-2 bg-white",
            t.border,
            t.shadow,
            "transition-transform duration-150",
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        ].join(" "), children: [_jsx(Handle, { type: "target", position: Position.Top, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}` }), _jsxs("div", { className: `flex items-center justify-between px-3 py-1 bg-orange-500 text-white ${t.pulse}`, children: [_jsxs("span", { className: "font-mono text-[9px] tracking-[0.25em]", children: ["DELAY \u00B7 ", t.label] }), _jsx("span", { className: "font-mono text-[10px]", children: t.glyph })] }), _jsx("div", { className: "bg-orange-50 px-3 py-2.5", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-lg leading-none", children: "\u23F1" }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "truncate text-[13px] font-semibold text-zinc-900", children: label }), _jsxs("div", { className: "font-mono text-[11px] text-orange-900", children: ["\u2261 ", formatSeconds(seconds)] })] })] }) }), _jsx(Handle, { type: "source", position: Position.Bottom, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}` })] }));
}
export const DelayNode = memo(DelayNodeImpl);
//# sourceMappingURL=DelayNode.js.map