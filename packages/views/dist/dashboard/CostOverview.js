"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from "react";
import { DollarSign, Coins, TrendingUp } from "lucide-react";
import { apiClient } from "@tide/core";
const PERIOD_LABELS = {
    today: "今日",
    week: "本周",
    month: "本月",
};
const DIMENSION_LABELS = {
    agent: "Agent",
    model: "Model",
    project: "Project",
};
function formatTokens(n) {
    return (n !== null && n !== void 0 ? n : 0).toLocaleString("en-US");
}
async function fetchCostSummary(period) {
    try {
        return await apiClient.get(`/api/dashboard/cost-summary?workspace_id=default&period=${period}`);
    }
    catch (_a) {
        return null;
    }
}
async function fetchCostByDimension(dimension, period) {
    try {
        const data = await apiClient.get(`/api/dashboard/cost-by-dimension?workspace_id=default&dimension=${dimension}&period=${period}`);
        return Array.isArray(data) ? data : [];
    }
    catch (_a) {
        return [];
    }
}
export function CostOverview() {
    var _a;
    const [period, setPeriod] = useState("today");
    const [dimension, setDimension] = useState("agent");
    const [summary, setSummary] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const loadData = useCallback(async () => {
        setLoading(true);
        const [s, d] = await Promise.all([
            fetchCostSummary(period),
            fetchCostByDimension(dimension, period),
        ]);
        setSummary(s);
        setItems(d);
        setLoading(false);
    }, [period, dimension]);
    useEffect(() => {
        loadData();
    }, [loadData]);
    return (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(DollarSign, { className: "h-4 w-4 text-emerald-600" }), _jsx("h2", { className: "text-sm font-semibold tracking-tight text-gray-900", children: "\u6210\u672C\u6982\u89C8" })] }), _jsx("div", { className: "flex items-center gap-1 rounded-lg border border-gray-200/60 bg-white/80 p-0.5", children: Object.keys(PERIOD_LABELS).map((p) => (_jsx("button", { onClick: () => setPeriod(p), className: `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${period === p
                                ? "bg-indigo-50 text-indigo-700"
                                : "text-gray-500 hover:text-gray-700"}`, children: PERIOD_LABELS[p] }, p))) })] }), _jsxs("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-3", children: [_jsxs("div", { className: "relative overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm", children: [_jsx("span", { "aria-hidden": true, className: "absolute inset-x-0 top-0 h-1 bg-emerald-500" }), _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0 space-y-1.5", children: [_jsxs("p", { className: "text-xs font-medium text-gray-500", children: [PERIOD_LABELS[period], "\u6210\u672C"] }), _jsx("p", { className: "text-2xl font-semibold tracking-tight tabular-nums text-emerald-600", children: loading ? "—" : summary ? `$${((_a = summary.total_cost) !== null && _a !== void 0 ? _a : 0).toFixed(4)}` : "$0.0000" })] }), _jsx("span", { className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600", children: _jsx(DollarSign, { className: "h-4 w-4" }) })] })] }), _jsxs("div", { className: "relative overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm", children: [_jsx("span", { "aria-hidden": true, className: "absolute inset-x-0 top-0 h-1 bg-sky-500" }), _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0 space-y-1.5", children: [_jsx("p", { className: "text-xs font-medium text-gray-500", children: "\u8F93\u5165 Tokens" }), _jsx("p", { className: "text-2xl font-semibold tracking-tight tabular-nums text-sky-600", children: loading ? "—" : summary ? formatTokens(summary.input_tokens) : "0" })] }), _jsx("span", { className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600", children: _jsx(Coins, { className: "h-4 w-4" }) })] })] }), _jsxs("div", { className: "relative overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm", children: [_jsx("span", { "aria-hidden": true, className: "absolute inset-x-0 top-0 h-1 bg-violet-500" }), _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0 space-y-1.5", children: [_jsx("p", { className: "text-xs font-medium text-gray-500", children: "\u8F93\u51FA Tokens" }), _jsx("p", { className: "text-2xl font-semibold tracking-tight tabular-nums text-violet-600", children: loading ? "—" : summary ? formatTokens(summary.output_tokens) : "0" })] }), _jsx("span", { className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600", children: _jsx(TrendingUp, { className: "h-4 w-4" }) })] })] })] }), _jsxs("div", { className: "overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 shadow-sm backdrop-blur-sm", children: [_jsxs("div", { className: "flex items-center gap-2 border-b border-gray-200/60 px-4 py-3", children: [_jsx("h3", { className: "text-sm font-medium text-gray-900", children: "\u6210\u672C\u5206\u5E03" }), _jsx("div", { className: "ml-auto flex items-center gap-1 rounded-lg border border-gray-200/60 bg-gray-50/80 p-0.5", children: Object.keys(DIMENSION_LABELS).map((d) => (_jsx("button", { onClick: () => setDimension(d), className: `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${dimension === d
                                        ? "bg-white text-indigo-700 shadow-sm"
                                        : "text-gray-500 hover:text-gray-700"}`, children: DIMENSION_LABELS[d] }, d))) })] }), loading ? (_jsx("div", { className: "py-8 text-center text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D..." })) : items.length === 0 ? (_jsx("div", { className: "py-8 text-center text-sm text-gray-400", children: "\u6682\u65E0\u6210\u672C\u6570\u636E" })) : (_jsx("div", { className: "divide-y divide-gray-100", children: items.map((item, idx) => {
                            var _a;
                            return (_jsxs("div", { className: "flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-50/60", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx("span", { className: "flex h-5 w-5 items-center justify-center rounded text-xs font-medium text-gray-400", children: idx + 1 }), _jsx("span", { className: "text-sm text-gray-900", children: item.name })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("span", { className: "text-xs text-gray-400", children: [formatTokens(item.tokens), " tokens"] }), _jsxs("span", { className: "text-sm font-medium tabular-nums text-gray-900", children: ["$", ((_a = item.cost) !== null && _a !== void 0 ? _a : 0).toFixed(4)] })] })] }, `${dimension}-${idx}`));
                        }) }))] })] }));
}
//# sourceMappingURL=CostOverview.js.map