"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { statusTone } from "../node-tones";
function EndNodeImpl({ data, selected }) {
    var _a;
    const status = data === null || data === void 0 ? void 0 : data.runStatus;
    const t = statusTone(status);
    const label = String((_a = data === null || data === void 0 ? void 0 : data.label) !== null && _a !== void 0 ? _a : "End");
    return (_jsxs("div", { className: [
            "relative flex h-[88px] w-[88px] select-none items-center justify-center",
            "rounded-full border-2 bg-rose-50",
            t.border,
            t.shadow,
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
            "transition-transform duration-150",
        ].join(" "), children: [_jsx(Handle, { type: "target", position: Position.Top, className: "!h-2.5 !w-2.5 !rounded-none !border-0 !bg-rose-700" }), _jsxs("div", { className: "flex flex-col items-center gap-0.5", children: [_jsx("span", { className: "text-2xl leading-none text-rose-700", children: "\u25A0" }), _jsx("span", { className: "font-mono text-[9px] tracking-[0.25em] text-rose-900", children: label.toUpperCase().slice(0, 8) })] })] }));
}
export const EndNode = memo(EndNodeImpl);
//# sourceMappingURL=EndNode.js.map