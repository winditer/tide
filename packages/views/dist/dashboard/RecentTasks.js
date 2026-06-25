"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Badge } from "@tide/ui";
import { useRecentTasks } from "@tide/core";
const STATUS_VARIANT = {
    queued: "secondary",
    running: "default",
    review: "outline",
    completed: "secondary",
    failed: "destructive",
    stopped: "outline",
    approved: "secondary",
    rejected: "destructive",
};
const STATUS_LABEL = {
    queued: "排队中",
    running: "运行中",
    review: "待审批",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止",
    approved: "已批准",
    rejected: "已拒绝",
};
function formatTime(iso) {
    if (!iso)
        return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", {
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
function truncate(str, max = 60) {
    return str.length > max ? str.slice(0, max) + "…" : str;
}
function TaskRow({ task }) {
    var _a, _b;
    return (_jsxs(Link, { href: `/tasks/${task.id}`, className: "flex items-center gap-3 px-5 py-3 transition-smooth hover:bg-muted/50", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "truncate text-sm font-medium", children: truncate(task.prompt) }), _jsxs("div", { className: "mt-1 flex items-center gap-2 text-xs text-muted-foreground", children: [task.agent_id && (_jsx("span", { className: "rounded bg-secondary px-1.5 py-0.5 font-mono", children: task.agent_id })), _jsx("span", { children: formatTime(task.created_at) })] })] }), _jsx(Badge, { variant: (_a = STATUS_VARIANT[task.status]) !== null && _a !== void 0 ? _a : "outline", className: "shrink-0", children: (_b = STATUS_LABEL[task.status]) !== null && _b !== void 0 ? _b : task.status })] }));
}
export function RecentTasks() {
    var _a;
    const { data, isLoading, isError } = useRecentTasks(10);
    const tasks = (_a = data === null || data === void 0 ? void 0 : data.tasks) !== null && _a !== void 0 ? _a : [];
    return (_jsxs("section", { className: "overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 shadow-sm backdrop-blur-sm", children: [_jsxs("header", { className: "flex items-center justify-between border-b border-gray-200/60 px-5 py-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(ListChecks, { className: "h-4 w-4 text-indigo-600" }), _jsx("h2", { className: "text-sm font-semibold tracking-tight text-gray-900", children: "\u6700\u8FD1\u4EFB\u52A1" })] }), _jsx(Link, { href: "/tasks", className: "text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700", children: "\u67E5\u770B\u5168\u90E8 \u2192" })] }), _jsx("div", { className: "px-0 py-0", children: isLoading ? (_jsx("div", { className: "py-10 text-center text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D..." })) : isError ? (_jsx("div", { className: "py-10 text-center text-sm text-red-500", children: "\u52A0\u8F7D\u5931\u8D25" })) : tasks.length === 0 ? (_jsx("div", { className: "py-10 text-center text-sm text-gray-400", children: "\u6682\u65E0\u4EFB\u52A1" })) : (_jsx("div", { className: "divide-y divide-gray-200/60", children: tasks.map((task) => (_jsx(TaskRow, { task: task }, task.id))) })) })] }));
}
//# sourceMappingURL=RecentTasks.js.map