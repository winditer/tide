"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { Badge } from "@tide/ui";
const STATUS_VARIANT = {
    success: "secondary",
    completed: "secondary",
    failed: "destructive",
    running: "default",
};
const STATUS_LABEL = {
    success: "成功",
    completed: "成功",
    failed: "失败",
    running: "运行中",
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
            second: "2-digit",
        });
    }
    catch (_a) {
        return iso;
    }
}
/** 超时阈值: 1小时 */
const TIMEOUT_MS = 60 * 60 * 1000;
function calcDuration(started, finished) {
    if (!finished) {
        // 没有结束时间：判断是否超时
        const elapsed = Date.now() - new Date(started).getTime();
        if (elapsed > TIMEOUT_MS) {
            return "已超时";
        }
        return "进行中";
    }
    const ms = new Date(finished).getTime() - new Date(started).getTime();
    if (ms < 0)
        return "—";
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
}
/** 根据 task_type 和 task_id 生成跳转链接 */
function getTaskLink(run) {
    if (!run.task_id)
        return null;
    const label = run.task_title || run.task_id.slice(0, 8);
    if (run.task_type === "plan") {
        return { href: `/plans/${run.task_id}`, label };
    }
    if (run.task_type === "workflow") {
        return { href: `/workflows/${run.task_id}`, label };
    }
    // default: link to tasks
    return { href: `/tasks/${run.task_id}`, label };
}
export function ScheduleRunHistory({ runs }) {
    // 后端可能返回数组或 { items: [...] } 包装体，这里统一做防护。
    const safeRuns = Array.isArray(runs)
        ? runs
        : Array.isArray(runs === null || runs === void 0 ? void 0 : runs.items)
            ? runs.items
            : [];
    if (safeRuns.length === 0) {
        return (_jsx("div", { className: "bg-card rounded-xl shadow-card overflow-hidden", children: _jsx("div", { className: "py-12 text-center text-sm text-muted-foreground", children: "\u6682\u65E0\u6267\u884C\u8BB0\u5F55" }) }));
    }
    return (_jsx("div", { className: "bg-card rounded-xl shadow-card overflow-hidden", children: _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground", children: [_jsx("th", { className: "px-4 py-3 font-medium", children: "\u72B6\u6001" }), _jsx("th", { className: "px-4 py-3 font-medium", children: "\u5173\u8054\u4EFB\u52A1" }), _jsx("th", { className: "px-4 py-3 font-medium", children: "\u5F00\u59CB\u65F6\u95F4" }), _jsx("th", { className: "px-4 py-3 font-medium", children: "\u7ED3\u675F\u65F6\u95F4" }), _jsx("th", { className: "px-4 py-3 font-medium", children: "\u8017\u65F6" }), _jsx("th", { className: "px-4 py-3 font-medium", children: "\u9519\u8BEF\u4FE1\u606F" })] }) }), _jsx("tbody", { className: "divide-y divide-border/50", children: safeRuns.map((run) => {
                            var _a, _b;
                            const endTime = run.finished_at || run.completed_at;
                            const taskLink = getTaskLink(run);
                            return (_jsxs("tr", { className: "hover:bg-muted/50 transition-smooth", children: [_jsx("td", { className: "px-4 py-3", children: _jsx(Badge, { variant: (_a = STATUS_VARIANT[run.status]) !== null && _a !== void 0 ? _a : "outline", children: (_b = STATUS_LABEL[run.status]) !== null && _b !== void 0 ? _b : run.status }) }), _jsx("td", { className: "px-4 py-3 max-w-[180px] truncate", children: taskLink ? (_jsx(Link, { href: taskLink.href, className: "text-primary hover:underline text-xs", children: taskLink.label })) : (_jsx("span", { className: "text-muted-foreground", children: "\u2014" })) }), _jsx("td", { className: "px-4 py-3 text-muted-foreground", children: formatTime(run.started_at) }), _jsx("td", { className: "px-4 py-3 text-muted-foreground", children: formatTime(endTime) }), _jsx("td", { className: "px-4 py-3 font-mono text-xs", children: calcDuration(run.started_at, endTime) }), _jsx("td", { className: "max-w-[200px] truncate px-4 py-3 text-xs text-destructive", children: run.error || "—" })] }, run.id));
                        }) })] }) }) }));
}
//# sourceMappingURL=ScheduleRunHistory.js.map