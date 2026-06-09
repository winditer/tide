"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Card, CardContent } from "@lark2codex/ui";
import { useDashboardStats } from "@lark2codex/core";
const STATS = [
    { key: "running", label: "运行中", icon: "⚡", color: "text-blue-600" },
    { key: "queued", label: "排队中", icon: "⏳", color: "text-yellow-600" },
    { key: "pending_approval", label: "待审批", icon: "🔔", color: "text-orange-600" },
    { key: "completed_today", label: "今日完成", icon: "✅", color: "text-green-600" },
];
export function StatCards() {
    const { data, isLoading } = useDashboardStats();
    return (_jsx("div", { className: "grid grid-cols-2 gap-4 sm:grid-cols-4", children: STATS.map((stat) => {
            var _a;
            return (_jsx(Card, { children: _jsxs(CardContent, { className: "flex items-center gap-3 p-4", children: [_jsx("span", { className: "text-2xl", children: stat.icon }), _jsxs("div", { children: [_jsx("p", { className: `text-2xl font-bold ${stat.color}`, children: isLoading ? "—" : ((_a = data === null || data === void 0 ? void 0 : data[stat.key]) !== null && _a !== void 0 ? _a : 0) }), _jsx("p", { className: "text-xs text-muted-foreground", children: stat.label })] })] }) }, stat.key));
        }) }));
}
//# sourceMappingURL=StatCards.js.map