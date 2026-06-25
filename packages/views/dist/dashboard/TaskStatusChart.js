"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BarChart3 } from "lucide-react";
import { useTaskStatusDistribution } from "@tide/core";
const STATUS_ROWS = [
    {
        key: "queued",
        label: "排队中",
        barClass: "bg-amber-400",
        textClass: "text-amber-700",
    },
    {
        key: "running",
        label: "运行中",
        barClass: "bg-indigo-500",
        textClass: "text-indigo-700",
    },
    {
        key: "review",
        label: "待审批",
        barClass: "bg-orange-400",
        textClass: "text-orange-700",
    },
    {
        key: "completed",
        label: "已完成",
        barClass: "bg-emerald-500",
        textClass: "text-emerald-700",
    },
    {
        key: "failed",
        label: "失败",
        barClass: "bg-red-500",
        textClass: "text-red-700",
    },
    {
        key: "cancelled",
        label: "已取消",
        barClass: "bg-gray-400",
        textClass: "text-gray-700",
    },
];
export function TaskStatusChart() {
    const { data, isLoading, isError } = useTaskStatusDistribution();
    const distribution = data !== null && data !== void 0 ? data : null;
    const max = distribution
        ? Math.max(1, ...STATUS_ROWS.map((r) => { var _a; return (_a = distribution[r.key]) !== null && _a !== void 0 ? _a : 0; }))
        : 1;
    const total = distribution
        ? STATUS_ROWS.reduce((sum, r) => { var _a; return sum + ((_a = distribution[r.key]) !== null && _a !== void 0 ? _a : 0); }, 0)
        : 0;
    return (_jsxs("section", { className: "rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm", children: [_jsxs("header", { className: "mb-4 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(BarChart3, { className: "h-4 w-4 text-indigo-600" }), _jsx("h2", { className: "text-sm font-semibold tracking-tight text-gray-900", children: "\u4EFB\u52A1\u72B6\u6001\u5206\u5E03" })] }), distribution && (_jsxs("span", { className: "text-xs text-gray-400", children: ["\u5171 ", total] }))] }), isLoading ? (_jsx("div", { className: "py-8 text-center text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D..." })) : isError || !distribution ? (_jsx("div", { className: "py-8 text-center text-sm text-red-500", children: "\u52A0\u8F7D\u5931\u8D25" })) : total === 0 ? (_jsx("div", { className: "py-8 text-center text-sm text-gray-400", children: "\u6682\u65E0\u6570\u636E" })) : (_jsx("ul", { className: "space-y-2.5", children: STATUS_ROWS.map((row) => {
                    var _a;
                    const value = (_a = distribution[row.key]) !== null && _a !== void 0 ? _a : 0;
                    const ratio = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
                    return (_jsxs("li", { className: "grid grid-cols-[64px_1fr_36px] items-center gap-3", children: [_jsx("span", { className: `text-xs font-medium ${row.textClass}`, children: row.label }), _jsx("div", { className: "h-2 overflow-hidden rounded-full bg-gray-100", children: _jsx("div", { className: `h-full rounded-full ${row.barClass} transition-[width] duration-500 ease-out`, style: { width: `${ratio}%` } }) }), _jsx("span", { className: "text-right font-mono text-xs tabular-nums text-gray-700", children: value })] }, row.key));
                }) }))] }));
}
//# sourceMappingURL=TaskStatusChart.js.map