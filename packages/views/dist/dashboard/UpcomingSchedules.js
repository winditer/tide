"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { CalendarClock, Clock } from "lucide-react";
import { useUpcomingSchedules } from "@tide/core";
import { formatAbsoluteTime, formatRelativeTime } from "./format-time";
const TYPE_LABEL = {
    cron: "Cron",
    interval: "Interval",
    date: "一次",
};
function isUrgent(schedule) {
    if (!schedule.next_run_at)
        return false;
    const ts = new Date(schedule.next_run_at).getTime();
    if (Number.isNaN(ts))
        return false;
    const diff = ts - Date.now();
    return diff > 0 && diff <= 60 * 60 * 1000; // 1 小时内
}
export function UpcomingSchedules() {
    const { data, isLoading, isError } = useUpcomingSchedules(5);
    const items = data !== null && data !== void 0 ? data : [];
    return (_jsxs("section", { className: "rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm", children: [_jsxs("header", { className: "mb-4 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(CalendarClock, { className: "h-4 w-4 text-indigo-600" }), _jsx("h2", { className: "text-sm font-semibold tracking-tight text-gray-900", children: "\u5373\u5C06\u6267\u884C" })] }), _jsx(Link, { href: "/schedules", className: "text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700", children: "\u5168\u90E8 \u2192" })] }), isLoading ? (_jsx("div", { className: "py-6 text-center text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D..." })) : isError ? (_jsx("div", { className: "py-6 text-center text-sm text-red-500", children: "\u52A0\u8F7D\u5931\u8D25" })) : items.length === 0 ? (_jsx("div", { className: "py-6 text-center text-sm text-gray-400", children: "\u6682\u65E0\u8C03\u5EA6\u8BA1\u5212" })) : (_jsx("ul", { className: "space-y-1.5", children: items.map((s) => {
                    var _a;
                    const urgent = isUrgent(s);
                    const type = s.schedule_type || "";
                    return (_jsx("li", { children: _jsx(Link, { href: `/schedules/${s.id}`, className: `group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${urgent
                                ? "bg-orange-50/70 hover:bg-orange-100/70"
                                : "hover:bg-indigo-50/60"}`, children: _jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("p", { className: `truncate text-sm font-medium ${urgent
                                                    ? "text-orange-700"
                                                    : "text-gray-900 group-hover:text-indigo-700"}`, children: s.name }), _jsx("span", { className: `shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${urgent
                                                    ? "bg-orange-200/70 text-orange-700"
                                                    : "bg-gray-100 text-gray-500"}`, children: (_a = TYPE_LABEL[type]) !== null && _a !== void 0 ? _a : type })] }), _jsxs("div", { className: "mt-0.5 flex items-center gap-1.5 text-xs", children: [_jsx(Clock, { className: `h-3 w-3 ${urgent ? "text-orange-500" : "text-gray-400"}` }), _jsx("span", { className: urgent ? "text-orange-600" : "text-gray-500", title: formatAbsoluteTime(s.next_run_at), children: formatRelativeTime(s.next_run_at, {
                                                    fallback: "未排定",
                                                }) }), urgent && (_jsx("span", { className: "rounded bg-orange-500/90 px-1 py-px text-[10px] font-medium text-white", children: "\u5373\u5C06" }))] })] }) }) }, s.id));
                }) }))] }));
}
//# sourceMappingURL=UpcomingSchedules.js.map