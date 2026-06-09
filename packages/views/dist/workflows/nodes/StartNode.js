"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { statusTone } from "../node-tones";
function StartNodeImpl({ data, selected }) {
    var _a;
    const status = data === null || data === void 0 ? void 0 : data.runStatus;
    const t = statusTone(status);
    const label = String((_a = data === null || data === void 0 ? void 0 : data.label) !== null && _a !== void 0 ? _a : "Start");
    return (_jsxs("div", { className: [
            "relative flex h-[88px] w-[88px] select-none items-center justify-center",
            "rounded-full border-2 bg-emerald-50",
            t.border,
            t.shadow,
            t.pulse,
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
            "transition-transform duration-150",
        ].join(" "), children: [_jsxs("div", { className: "flex flex-col items-center gap-0.5", children: [_jsx("span", { className: "text-2xl leading-none text-emerald-700", children: "\u25B6" }), _jsx("span", { className: "font-mono text-[9px] tracking-[0.25em] text-emerald-900", children: label.toUpperCase().slice(0, 8) })] }), _jsx(Handle, { type: "source", position: Position.Bottom, className: "!h-2.5 !w-2.5 !rounded-none !border-0 !bg-emerald-700" })] }));
}
export const StartNode = memo(StartNodeImpl);
//# sourceMappingURL=StartNode.js.map