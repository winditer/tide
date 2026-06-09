"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { statusTone } from "../node-tones";
function AgentNodeImpl({ data, selected }) {
    var _a, _b;
    const d = (_a = data) !== null && _a !== void 0 ? _a : {};
    const status = d.runStatus;
    const t = statusTone(status);
    const label = String((_b = d.label) !== null && _b !== void 0 ? _b : "Agent");
    const model = d.model ? String(d.model) : null;
    const prompt = d.prompt ? String(d.prompt) : null;
    return (_jsxs("div", { className: [
            "group relative w-[240px] select-none border-2 bg-white",
            t.border,
            t.shadow,
            "transition-transform duration-150",
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        ].join(" "), children: [_jsx(Handle, { type: "target", position: Position.Top, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}` }), _jsxs("div", { className: `flex items-center justify-between px-3 py-1 ${t.accent} text-white ${t.pulse}`, children: [_jsxs("span", { className: "font-mono text-[9px] tracking-[0.25em]", children: ["AGENT \u00B7 ", t.label] }), _jsx("span", { className: "font-mono text-[10px]", children: t.glyph })] }), _jsxs("div", { className: `relative px-3 py-2.5 ${t.surface}`, children: [_jsxs("div", { className: "flex items-start gap-2", children: [_jsx("div", { className: "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-900 bg-white", children: _jsx("span", { className: "text-base", children: "\uD83E\uDD16" }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "truncate text-[13px] font-semibold text-zinc-900", children: label }), model && (_jsxs("div", { className: "mt-0.5 truncate font-mono text-[10px] uppercase tracking-wider text-zinc-600", children: ["\u232C ", model] }))] })] }), prompt && (_jsx("div", { className: "mt-2 line-clamp-2 border-t border-dashed border-zinc-300 pt-2 font-mono text-[10px] leading-relaxed text-zinc-600", children: prompt }))] }), _jsx(Handle, { type: "source", position: Position.Bottom, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}` })] }));
}
export const AgentNode = memo(AgentNodeImpl);
//# sourceMappingURL=AgentNode.js.map