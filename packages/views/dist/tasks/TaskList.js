"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRouter } from "next/navigation";
import { Badge } from "@lark2codex/ui";
import { Button } from "@lark2codex/ui";
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
function shortId(id) {
    return id.slice(0, 8);
}
function truncate(s, limit = 60) {
    if (!s)
        return "—";
    return s.length > limit ? s.slice(0, limit) + "…" : s;
}
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
export function TaskList({ items, total, page, pageSize, onPageChange, }) {
    const router = useRouter();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (items.length === 0) {
        return (_jsx("div", { className: "py-12 text-center text-muted-foreground", children: "\u6682\u65E0\u4EFB\u52A1" }));
    }
    return (_jsxs("div", { children: [_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b text-left text-muted-foreground", children: [_jsx("th", { className: "px-3 py-3 font-medium", children: "ID" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "Prompt" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "Agent" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u72B6\u6001" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u521B\u5EFA\u65F6\u95F4" })] }) }), _jsx("tbody", { children: items.map((task) => {
                                var _a, _b;
                                return (_jsxs("tr", { className: "cursor-pointer border-b transition-colors hover:bg-muted/50", onClick: () => router.push(`/tasks/${task.id}`), children: [_jsx("td", { className: "px-3 py-3 font-mono text-xs", children: shortId(task.id) }), _jsx("td", { className: "max-w-[300px] truncate px-3 py-3", children: truncate(task.prompt) }), _jsx("td", { className: "px-3 py-3", children: task.agent_id || "—" }), _jsx("td", { className: "px-3 py-3", children: _jsx(Badge, { variant: (_a = STATUS_VARIANT[task.status]) !== null && _a !== void 0 ? _a : "outline", children: (_b = STATUS_LABEL[task.status]) !== null && _b !== void 0 ? _b : task.status }) }), _jsx("td", { className: "px-3 py-3 text-muted-foreground", children: formatTime(task.created_at) })] }, task.id));
                            }) })] }) }), totalPages > 1 && (_jsxs("div", { className: "flex items-center justify-between px-3 py-4", children: [_jsxs("span", { className: "text-sm text-muted-foreground", children: ["\u5171 ", total, " \u6761\uFF0C\u7B2C ", page, "/", totalPages, " \u9875"] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", disabled: page <= 1, onClick: () => onPageChange(page - 1), children: "\u4E0A\u4E00\u9875" }), _jsx(Button, { variant: "outline", size: "sm", disabled: page >= totalPages, onClick: () => onPageChange(page + 1), children: "\u4E0B\u4E00\u9875" })] })] }))] }));
}
//# sourceMappingURL=TaskList.js.map