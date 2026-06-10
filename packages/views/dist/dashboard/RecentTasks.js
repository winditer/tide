"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@tide/ui";
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
    return (_jsxs(Link, { href: `/tasks/${task.id}`, className: "flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent transition-colors", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "truncate text-sm", children: truncate(task.prompt) }), _jsxs("div", { className: "mt-0.5 flex items-center gap-2 text-xs text-muted-foreground", children: [task.agent_id && (_jsx("span", { className: "font-mono bg-secondary rounded px-1.5 py-0.5", children: task.agent_id })), _jsx("span", { children: formatTime(task.created_at) })] })] }), _jsx(Badge, { variant: (_a = STATUS_VARIANT[task.status]) !== null && _a !== void 0 ? _a : "outline", className: "shrink-0", children: (_b = STATUS_LABEL[task.status]) !== null && _b !== void 0 ? _b : task.status })] }));
}
export function RecentTasks() {
    var _a;
    const { data, isLoading, isError } = useRecentTasks(10);
    const tasks = (_a = data === null || data === void 0 ? void 0 : data.tasks) !== null && _a !== void 0 ? _a : [];
    return (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { className: "text-base", children: "\u6700\u8FD1\u4EFB\u52A1" }) }), _jsx(CardContent, { className: "px-2 pb-2", children: isLoading ? (_jsx("div", { className: "py-8 text-center text-sm text-muted-foreground", children: "\u52A0\u8F7D\u4E2D..." })) : isError ? (_jsx("div", { className: "py-8 text-center text-sm text-destructive", children: "\u52A0\u8F7D\u5931\u8D25" })) : tasks.length === 0 ? (_jsx("div", { className: "py-8 text-center text-sm text-muted-foreground", children: "\u6682\u65E0\u4EFB\u52A1" })) : (_jsx("div", { className: "divide-y", children: tasks.map((task) => (_jsx(TaskRow, { task: task }, task.id))) })) })] }));
}
//# sourceMappingURL=RecentTasks.js.map