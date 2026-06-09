"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../lib/utils";
const statusConfig = {
    connected: {
        dot: "bg-green-500",
        label: "已连接",
        pulse: "animate-pulse",
    },
    connecting: {
        dot: "bg-yellow-500",
        label: "连接中...",
        pulse: "animate-pulse",
    },
    disconnected: {
        dot: "bg-red-500",
        label: "已断开",
        pulse: "",
    },
};
export function ConnectionStatus({ status, className }) {
    const config = statusConfig[status];
    return (_jsxs("div", { className: cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className), children: [_jsx("span", { className: cn("inline-block h-2 w-2 rounded-full", config.dot, config.pulse) }), _jsx("span", { children: config.label })] }));
}
//# sourceMappingURL=connection-status.js.map