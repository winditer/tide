"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useMyWorkItems } from "@tide/core";
/** 工作项状态徽章配色：与 work-items 列表页 STATUS_CONFIG 保持一致。 */
const STATUS_CONFIG = {
    pending: {
        label: "待操作",
        color: "bg-gray-100 text-gray-700 border border-gray-200",
    },
    in_progress: {
        label: "进行中",
        color: "bg-blue-100 text-blue-700 border border-blue-200",
    },
    pending_approval: {
        label: "待审批",
        color: "bg-amber-100 text-amber-700 border border-amber-200",
    },
    completed: {
        label: "已完成",
        color: "bg-green-100 text-green-700 border border-green-200",
    },
    failed: {
        label: "失败",
        color: "bg-red-100 text-red-700 border border-red-200",
    },
    stopped: {
        label: "已停止",
        color: "bg-gray-200 text-gray-600 border border-gray-300",
    },
    waiting: {
        label: "等待中",
        color: "bg-purple-100 text-purple-700 border border-purple-200",
    },
};
const PRIORITY_CONFIG = {
    0: { label: "—", color: "text-gray-400" },
    1: { label: "低", color: "bg-blue-50 text-blue-700 border border-blue-200" },
    2: {
        label: "中",
        color: "bg-amber-50 text-amber-700 border border-amber-200",
    },
    3: {
        label: "高",
        color: "bg-orange-50 text-orange-700 border border-orange-200",
    },
    4: {
        label: "紧急",
        color: "bg-rose-50 text-rose-700 border border-rose-200",
    },
};
function truncate(str, max = 60) {
    return str.length > max ? str.slice(0, max) + "…" : str;
}
function WorkItemRow({ item }) {
    var _a;
    const statusCfg = item.status ? STATUS_CONFIG[item.status] : null;
    const priorityCfg = (_a = PRIORITY_CONFIG[item.priority]) !== null && _a !== void 0 ? _a : PRIORITY_CONFIG[0];
    return (_jsxs(Link, { href: `/work-items?project=${encodeURIComponent(item.project_id)}`, className: "group flex items-center gap-3 px-5 py-3 transition-smooth hover:bg-muted/50", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "truncate text-sm font-medium text-gray-900 group-hover:text-indigo-700", children: truncate(item.title || "(无标题)") }), _jsxs("div", { className: "mt-1 flex items-center gap-2 text-xs text-muted-foreground", children: [item.project_name && (_jsx("span", { className: "rounded bg-secondary px-1.5 py-0.5 truncate max-w-[160px]", children: item.project_name })), item.assignee && (_jsxs("span", { className: "truncate max-w-[80px]", children: ["@", item.assignee] }))] })] }), item.priority > 0 && (_jsx("span", { className: `shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priorityCfg.color}`, children: priorityCfg.label })), statusCfg && (_jsx("span", { className: `shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusCfg.color}`, children: statusCfg.label }))] }));
}
export function MyWorkItems() {
    const { data, isLoading, isError } = useMyWorkItems(10);
    const items = data !== null && data !== void 0 ? data : [];
    return (_jsxs("section", { className: "overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 shadow-sm backdrop-blur-sm", children: [_jsxs("header", { className: "flex items-center justify-between border-b border-gray-200/60 px-5 py-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(ClipboardList, { className: "h-4 w-4 text-sky-600" }), _jsx("h2", { className: "text-sm font-semibold tracking-tight text-gray-900", children: "\u6211\u7684\u5DE5\u4F5C\u9879" })] }), _jsx(Link, { href: "/work-items", className: "text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700", children: "\u67E5\u770B\u5168\u90E8 \u2192" })] }), _jsx("div", { className: "px-0 py-0", children: isLoading ? (_jsx("div", { className: "py-10 text-center text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D..." })) : isError ? (_jsx("div", { className: "py-10 text-center text-sm text-red-500", children: "\u52A0\u8F7D\u5931\u8D25" })) : items.length === 0 ? (_jsx("div", { className: "py-10 text-center text-sm text-gray-400", children: "\u6682\u65E0\u5F85\u529E\u5DE5\u4F5C\u9879" })) : (_jsx("div", { className: "divide-y divide-gray-200/60", children: items.map((item) => (_jsx(WorkItemRow, { item: item }, item.id))) })) })] }));
}
//# sourceMappingURL=MyWorkItems.js.map