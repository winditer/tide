"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "@tide/ui";
const STATUS_VARIANT = {
    success: "secondary",
    failed: "destructive",
    running: "default",
};
const STATUS_LABEL = {
    success: "成功",
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
function calcDuration(started, finished) {
    if (!finished)
        return "进行中";
    const ms = new Date(finished).getTime() - new Date(started).getTime();
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
}
export function ScheduleRunHistory({ runs }) {
    if (runs.length === 0) {
        return (_jsx("div", { className: "py-8 text-center text-muted-foreground", children: "\u6682\u65E0\u6267\u884C\u8BB0\u5F55" }));
    }
    return (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b text-left text-muted-foreground", children: [_jsx("th", { className: "px-3 py-3 font-medium", children: "\u72B6\u6001" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u5F00\u59CB\u65F6\u95F4" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u7ED3\u675F\u65F6\u95F4" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u8017\u65F6" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u9519\u8BEF\u4FE1\u606F" })] }) }), _jsx("tbody", { children: runs.map((run) => {
                        var _a, _b;
                        return (_jsxs("tr", { className: "border-b", children: [_jsx("td", { className: "px-3 py-3", children: _jsx(Badge, { variant: (_a = STATUS_VARIANT[run.status]) !== null && _a !== void 0 ? _a : "outline", children: (_b = STATUS_LABEL[run.status]) !== null && _b !== void 0 ? _b : run.status }) }), _jsx("td", { className: "px-3 py-3 text-muted-foreground", children: formatTime(run.started_at) }), _jsx("td", { className: "px-3 py-3 text-muted-foreground", children: formatTime(run.finished_at) }), _jsx("td", { className: "px-3 py-3 font-mono text-xs", children: calcDuration(run.started_at, run.finished_at) }), _jsx("td", { className: "max-w-[200px] truncate px-3 py-3 text-xs text-destructive", children: run.error || "—" })] }, run.id));
                    }) })] }) }));
}
//# sourceMappingURL=ScheduleRunHistory.js.map