"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function EmptyState({ message, hint }) {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/30 px-6 py-16 text-center", children: [_jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "40", height: "40", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", className: "text-muted-foreground/60", "aria-hidden": "true", children: [_jsx("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }), _jsx("path", { d: "M3 10h18" }), _jsx("path", { d: "M9 14h2" })] }), _jsx("p", { className: "text-sm text-muted-foreground", children: message }), hint && (_jsx("p", { className: "text-xs text-muted-foreground/80", children: hint }))] }));
}
//# sourceMappingURL=EmptyState.js.map