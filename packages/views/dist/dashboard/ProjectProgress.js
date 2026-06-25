"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { Layers, Target } from "lucide-react";
import { useGroupProgress, useProjectProgress } from "@tide/core";
function clampPercent(completed, total) {
    if (total <= 0)
        return 0;
    const pct = (completed / total) * 100;
    if (Number.isNaN(pct))
        return 0;
    return Math.max(0, Math.min(100, Math.round(pct)));
}
export function ProjectProgress() {
    const { data, isLoading, isError } = useProjectProgress(8);
    const { data: groupData } = useGroupProgress(6);
    const projects = data !== null && data !== void 0 ? data : [];
    const groups = groupData !== null && groupData !== void 0 ? groupData : [];
    return (_jsxs("section", { className: "rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm", children: [_jsxs("header", { className: "mb-4 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Target, { className: "h-4 w-4 text-emerald-600" }), _jsx("h2", { className: "text-sm font-semibold tracking-tight text-gray-900", children: "\u9879\u76EE\u8FDB\u5EA6" })] }), _jsx(Link, { href: "/work-items", className: "text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700", children: "\u5168\u90E8 \u2192" })] }), groups.length > 0 && (_jsxs("div", { className: "mb-4", children: [_jsxs("div", { className: "mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500", children: [_jsx(Layers, { className: "h-3 w-3 text-amber-500" }), "\u9879\u76EE\u7EC4"] }), _jsx("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: groups.map((g) => {
                            const percent = clampPercent(g.completed, g.total);
                            const isDone = percent >= 100;
                            return (_jsxs(Link, { href: `/work-items?scope=group:${encodeURIComponent(g.id)}`, className: "group block rounded-lg border border-amber-200/50 bg-amber-50/40 p-3 transition-all hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 text-sm", children: [_jsxs("span", { className: "flex items-center gap-1.5 truncate font-medium text-gray-900 group-hover:text-amber-700", children: [_jsx(Layers, { className: "h-3.5 w-3.5 shrink-0 text-amber-500" }), _jsx("span", { className: "truncate", children: g.name })] }), _jsxs("span", { className: "shrink-0 tabular-nums text-xs text-muted-foreground", children: [g.completed, "/", g.total] })] }), _jsx("div", { className: "mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-100", children: _jsx("div", { className: `h-full rounded-full transition-all ${isDone
                                                ? "bg-emerald-500"
                                                : "bg-gradient-to-r from-amber-400 to-orange-500"}`, style: { width: `${percent}%` } }) }), _jsxs("div", { className: "mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground", children: [_jsxs("span", { className: "tabular-nums", children: [percent, "%"] }), _jsx("span", { children: g.accessible_member_count < g.member_count
                                                    ? `${g.accessible_member_count}/${g.member_count} 项目`
                                                    : `${g.member_count} 项目` })] })] }, g.id));
                        }) })] })), groups.length > 0 && (_jsxs("div", { className: "mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500", children: [_jsx(Target, { className: "h-3 w-3 text-emerald-500" }), "\u9879\u76EE"] })), isLoading ? (_jsx("div", { className: "py-6 text-center text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D..." })) : isError ? (_jsx("div", { className: "py-6 text-center text-sm text-red-500", children: "\u52A0\u8F7D\u5931\u8D25" })) : projects.length === 0 ? (_jsx("div", { className: "py-6 text-center text-sm text-gray-400", children: groups.length > 0 ? "暂无项目数据" : "暂无项目工作项数据" })) : (_jsx("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: projects.map((p) => {
                    const percent = clampPercent(p.completed, p.total);
                    const isDone = percent >= 100;
                    return (_jsxs(Link, { href: `/work-items?project=${encodeURIComponent(p.id)}`, className: "group block rounded-lg border border-gray-200/60 bg-white/60 p-3 transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 text-sm", children: [_jsx("span", { className: "truncate font-medium text-gray-900 group-hover:text-indigo-700", children: p.name }), _jsxs("span", { className: "shrink-0 tabular-nums text-xs text-muted-foreground", children: [p.completed, "/", p.total] })] }), _jsx("div", { className: "mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100", children: _jsx("div", { className: `h-full rounded-full transition-all ${isDone
                                        ? "bg-emerald-500"
                                        : "bg-gradient-to-r from-indigo-400 to-indigo-500"}`, style: { width: `${percent}%` } }) }), _jsxs("div", { className: "mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground", children: [_jsxs("span", { className: "tabular-nums", children: [percent, "%"] }), isDone && (_jsx("span", { className: "font-medium text-emerald-600", children: "\u5DF2\u5B8C\u6210" }))] })] }, p.id));
                }) }))] }));
}
//# sourceMappingURL=ProjectProgress.js.map