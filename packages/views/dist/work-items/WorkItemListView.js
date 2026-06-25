"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { useWorkItems, useVersions, } from "@tide/core";
const STATUS_CONFIG = {
    pending: { label: "待操作", color: "bg-gray-100 text-gray-700 border border-gray-200" },
    in_progress: { label: "进行中", color: "bg-blue-100 text-blue-700 border border-blue-200" },
    pending_approval: { label: "待审批", color: "bg-amber-100 text-amber-700 border border-amber-200" },
    completed: { label: "已完成", color: "bg-green-100 text-green-700 border border-green-200" },
    failed: { label: "失败", color: "bg-red-100 text-red-700 border border-red-200" },
    stopped: { label: "已停止", color: "bg-gray-200 text-gray-600 border border-gray-300" },
    waiting: { label: "等待中", color: "bg-purple-100 text-purple-700 border border-purple-200" },
};
const PRIORITY_CONFIG = {
    0: { label: "—", color: "" },
    1: { label: "低", color: "bg-blue-50 text-blue-700 border border-blue-200" },
    2: { label: "中", color: "bg-amber-50 text-amber-700 border border-amber-200" },
    3: { label: "高", color: "bg-orange-50 text-orange-700 border border-orange-200" },
    4: { label: "紧急", color: "bg-rose-50 text-rose-700 border border-rose-200" },
};
function formatTime(iso) {
    if (!iso)
        return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    catch (_a) {
        return iso;
    }
}
export function WorkItemListView({ projectId, filters, onItemClick }) {
    const { data: items, isLoading, isError } = useWorkItems(projectId, filters);
    const { data: versions } = useVersions(projectId);
    const versionNameMap = useMemo(() => {
        const map = {};
        for (const v of versions !== null && versions !== void 0 ? versions : []) {
            map[v.id] = v.name;
        }
        return map;
    }, [versions]);
    if (isLoading) {
        return (_jsx("div", { className: "py-16 text-center text-sm text-muted-foreground", children: "\u52A0\u8F7D\u5217\u8868\u4E2D\u2026" }));
    }
    if (isError) {
        return (_jsx("div", { className: "py-16 text-center text-sm text-destructive", children: "\u5217\u8868\u52A0\u8F7D\u5931\u8D25" }));
    }
    if (!items || items.length === 0) {
        return (_jsx("div", { className: "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/40 py-16 text-center", children: _jsx("p", { className: "text-sm text-muted-foreground", children: "\u6682\u65E0\u5DE5\u4F5C\u9879" }) }));
    }
    return (_jsx("div", { className: "overflow-hidden rounded-xl border border-border/60 bg-card shadow-card", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-border/50 bg-muted/30", children: [_jsx("th", { className: "px-4 py-3 text-left font-medium text-muted-foreground", children: "\u6807\u9898" }), _jsx("th", { className: "px-4 py-3 text-left font-medium text-muted-foreground w-24", children: "\u72B6\u6001" }), _jsx("th", { className: "px-4 py-3 text-left font-medium text-muted-foreground w-24", children: "\u8D1F\u8D23\u4EBA" }), _jsx("th", { className: "px-4 py-3 text-left font-medium text-muted-foreground w-28", children: "\u7248\u672C" }), _jsx("th", { className: "px-4 py-3 text-left font-medium text-muted-foreground w-20", children: "\u4F18\u5148\u7EA7" }), _jsx("th", { className: "px-4 py-3 text-left font-medium text-muted-foreground w-40", children: "\u521B\u5EFA\u65F6\u95F4" })] }) }), _jsx("tbody", { children: items.map((item) => {
                        var _a;
                        const statusCfg = item.status ? STATUS_CONFIG[item.status] : null;
                        const priorityCfg = (_a = PRIORITY_CONFIG[item.priority]) !== null && _a !== void 0 ? _a : PRIORITY_CONFIG[0];
                        return (_jsxs("tr", { onClick: () => onItemClick === null || onItemClick === void 0 ? void 0 : onItemClick(item), className: "border-b border-border/30 transition-colors hover:bg-muted/20 cursor-pointer last:border-b-0", children: [_jsxs("td", { className: "px-4 py-3", children: [_jsx("div", { className: "font-medium text-foreground line-clamp-1", children: item.title || "(无标题)" }), item.description && (_jsx("div", { className: "mt-0.5 text-xs text-muted-foreground line-clamp-1", children: item.description }))] }), _jsx("td", { className: "px-4 py-3", children: statusCfg ? (_jsx("span", { className: `inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusCfg.color}`, children: statusCfg.label })) : (_jsx("span", { className: "text-xs text-muted-foreground", children: "\u2014" })) }), _jsx("td", { className: "px-4 py-3", children: item.assignee ? (_jsxs("span", { className: "flex items-center gap-1.5 text-xs", children: [_jsx("span", { className: "flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary", children: item.assignee.slice(0, 1) }), _jsx("span", { className: "truncate max-w-[80px]", children: item.assignee })] })) : (_jsx("span", { className: "text-xs text-muted-foreground", children: "\u2014" })) }), _jsx("td", { className: "px-4 py-3", children: item.version_id ? (_jsx("span", { className: "inline-flex items-center rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground", children: versionNameMap[item.version_id] || item.version_id.slice(0, 8) })) : (_jsx("span", { className: "text-xs text-muted-foreground", children: "\u2014" })) }), _jsx("td", { className: "px-4 py-3", children: item.priority > 0 ? (_jsx("span", { className: `inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priorityCfg.color}`, children: priorityCfg.label })) : (_jsx("span", { className: "text-xs text-muted-foreground", children: "\u2014" })) }), _jsx("td", { className: "px-4 py-3 text-xs text-muted-foreground tabular-nums", children: formatTime(item.created_at) })] }, item.id));
                    }) })] }) }));
}
//# sourceMappingURL=WorkItemListView.js.map