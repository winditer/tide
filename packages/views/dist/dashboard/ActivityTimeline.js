"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { Activity, Plus, RefreshCw, CheckCircle2, XCircle, ShieldAlert, ShieldCheck, Circle, } from "lucide-react";
import { useActivityTimeline } from "@tide/core";
import { formatRelativeTime } from "./format-time";
function resolveEventStyle(event) {
    var _a, _b;
    const type = event.event_type || "";
    const payload = ((_a = event.payload) !== null && _a !== void 0 ? _a : {});
    const newStatus = String((_b = payload.new_status) !== null && _b !== void 0 ? _b : "");
    // 后端 _record_event 以 ``status_changed:<new_status>`` 写入状态变更事件，
    // 这里从事件名中反解末状态以补充 payload 漏洞。
    const statusFromType = type.startsWith("status_changed:")
        ? type.slice("status_changed:".length)
        : "";
    const effectiveStatus = newStatus || statusFromType;
    if (type === "task.created" || type === "task_created" || type === "created") {
        return {
            icon: Plus,
            label: "创建了任务",
            iconClass: "text-blue-600 bg-blue-50",
            ringClass: "ring-blue-100",
        };
    }
    if (type === "task.completed" ||
        type === "task_completed" ||
        effectiveStatus === "completed") {
        return {
            icon: CheckCircle2,
            label: "完成了任务",
            iconClass: "text-emerald-600 bg-emerald-50",
            ringClass: "ring-emerald-100",
        };
    }
    if (type === "task.failed" || effectiveStatus === "failed") {
        return {
            icon: XCircle,
            label: "任务失败",
            iconClass: "text-red-600 bg-red-50",
            ringClass: "ring-red-100",
        };
    }
    if (type === "task.status_changed" ||
        type === "status_changed" ||
        type.startsWith("status_changed:") ||
        type === "updated" ||
        type === "task.updated") {
        return {
            icon: RefreshCw,
            label: effectiveStatus ? `任务状态 → ${effectiveStatus}` : "任务更新",
            iconClass: "text-amber-600 bg-amber-50",
            ringClass: "ring-amber-100",
        };
    }
    if (type === "approval.requested" ||
        type === "review_requested" ||
        type === "approval_request") {
        return {
            icon: ShieldAlert,
            label: "发起了审批",
            iconClass: "text-orange-600 bg-orange-50",
            ringClass: "ring-orange-100",
        };
    }
    if (type === "approval.resolved" ||
        type === "approval_resolved" ||
        type === "approval_approved" ||
        type === "approval_rejected") {
        const rejected = type === "approval_rejected";
        return {
            icon: rejected ? XCircle : ShieldCheck,
            label: rejected ? "审批已拒绝" : "审批已通过",
            iconClass: rejected
                ? "text-rose-600 bg-rose-50"
                : "text-emerald-600 bg-emerald-50",
            ringClass: rejected ? "ring-rose-100" : "ring-emerald-100",
        };
    }
    return {
        icon: Circle,
        label: type || "事件",
        iconClass: "text-gray-500 bg-gray-100",
        ringClass: "ring-gray-100",
    };
}
function buildDescription(event, label) {
    var _a, _b;
    const title = (_a = event.task_title) === null || _a === void 0 ? void 0 : _a.trim();
    const project = (_b = event.project_name) === null || _b === void 0 ? void 0 : _b.trim();
    const target = title ? `「${title.slice(0, 28)}${title.length > 28 ? "…" : ""}」` : "";
    const projectTag = project ? ` · ${project}` : "";
    return `${label}${target}${projectTag}`;
}
export function ActivityTimeline() {
    const { data, isLoading, isError } = useActivityTimeline(15);
    const events = data !== null && data !== void 0 ? data : [];
    return (_jsxs("section", { className: "rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm", children: [_jsx("header", { className: "mb-4 flex items-center justify-between", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Activity, { className: "h-4 w-4 text-indigo-600" }), _jsx("h2", { className: "text-sm font-semibold tracking-tight text-gray-900", children: "\u6D3B\u52A8\u65F6\u95F4\u7EBF" })] }) }), isLoading ? (_jsx("div", { className: "py-10 text-center text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D..." })) : isError ? (_jsx("div", { className: "py-10 text-center text-sm text-red-500", children: "\u52A0\u8F7D\u5931\u8D25" })) : events.length === 0 ? (_jsx("div", { className: "py-10 text-center text-sm text-gray-400", children: "\u6682\u65E0\u6D3B\u52A8" })) : (_jsxs("ol", { className: "relative space-y-4", children: [_jsx("span", { "aria-hidden": true, className: "absolute left-[11px] top-1 bottom-1 w-px bg-gradient-to-b from-gray-200 via-gray-200/70 to-transparent" }), events.map((event) => {
                        const style = resolveEventStyle(event);
                        const Icon = style.icon;
                        return (_jsxs("li", { className: "relative flex gap-3 pl-0", children: [_jsx("span", { className: `relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ${style.ringClass} ${style.iconClass}`, children: _jsx(Icon, { className: "h-3 w-3" }) }), _jsxs("div", { className: "min-w-0 flex-1 pt-0.5", children: [_jsx("p", { className: "truncate text-sm text-gray-800", children: buildDescription(event, style.label) }), _jsx("p", { className: "mt-0.5 text-xs text-gray-400", children: formatRelativeTime(event.created_at) })] })] }, event.id));
                    })] })), _jsx("div", { className: "mt-4 border-t border-gray-200/60 pt-3 text-center", children: _jsx(Link, { href: "/tasks", className: "text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700", children: "\u67E5\u770B\u66F4\u591A \u2192" }) })] }));
}
//# sourceMappingURL=ActivityTimeline.js.map