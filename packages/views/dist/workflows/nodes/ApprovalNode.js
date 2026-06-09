"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { statusTone } from "../node-tones";
function ApprovalNodeImpl({ data, selected }) {
    var _a, _b;
    const d = (_a = data) !== null && _a !== void 0 ? _a : {};
    const status = d.runStatus;
    const t = statusTone(status);
    const label = String((_b = d.label) !== null && _b !== void 0 ? _b : "Approval");
    const approvers = Array.isArray(d.approvers) ? d.approvers : [];
    return (_jsxs("div", { className: [
            "group relative w-[220px] select-none border-2 bg-white",
            t.border,
            t.shadow,
            "transition-transform duration-150",
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        ].join(" "), children: [_jsx(Handle, { type: "target", position: Position.Top, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}` }), _jsxs("div", { className: `flex items-center justify-between px-3 py-1 bg-violet-600 text-white ${t.pulse}`, children: [_jsxs("span", { className: "font-mono text-[9px] tracking-[0.25em]", children: ["APPROVAL \u00B7 ", t.label] }), _jsx("span", { className: "font-mono text-[10px]", children: t.glyph })] }), _jsxs("div", { className: "relative bg-violet-50 px-3 py-2.5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-lg leading-none", children: "\uD83D\uDEE1\uFE0F" }), _jsx("div", { className: "min-w-0 flex-1", children: _jsx("div", { className: "truncate text-[13px] font-semibold text-zinc-900", children: label }) })] }), approvers.length > 0 && (_jsxs("div", { className: "mt-2 flex flex-wrap gap-1 border-t border-dashed border-violet-300 pt-2", children: [approvers.slice(0, 3).map((a) => (_jsxs("span", { className: "border border-violet-700 bg-white px-1.5 py-[1px] font-mono text-[9px] tracking-wider text-violet-900", children: ["@", a] }, a))), approvers.length > 3 && (_jsxs("span", { className: "font-mono text-[9px] text-violet-700", children: ["+", approvers.length - 3] }))] }))] }), _jsx(Handle, { type: "source", position: Position.Bottom, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}` })] }));
}
export const ApprovalNode = memo(ApprovalNodeImpl);
//# sourceMappingURL=ApprovalNode.js.map