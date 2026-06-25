"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button } from "@tide/ui";
import { useTaskQuery, useStopTaskMutation, useRetryTaskMutation, useApproveTaskMutation, useRejectTaskMutation, } from "@tide/core";
const STATUS_LABEL = {
    queued: "排队中",
    running: "运行中",
    review: "待审批",
    approved: "已批准",
    completed: "已完成",
    failed: "失败",
    rejected: "已拒绝",
    stopped: "已停止",
    cancelled: "已取消",
};
const STATUS_COLOR = {
    queued: "bg-slate-400",
    running: "bg-amber-500",
    review: "bg-violet-500",
    approved: "bg-emerald-500",
    completed: "bg-emerald-600",
    failed: "bg-rose-600",
    rejected: "bg-rose-500",
    stopped: "bg-zinc-500",
    cancelled: "bg-zinc-500",
};
function formatTime(iso) {
    if (!iso)
        return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN");
    }
    catch (_a) {
        return iso;
    }
}
function formatDuration(ms) {
    if (ms == null || Number.isNaN(ms))
        return "—";
    if (ms < 1000)
        return `${Math.max(0, Math.round(ms))}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
        return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}
/**
 * 计算耗时：优先使用 duration_ms；否则从 started_at/completed_at 推算；
 * 若任务仍在运行，则使用当前时间作为终点。
 */
function computeDurationMs(duration_ms, started_at, completed_at, status) {
    if (typeof duration_ms === "number" && duration_ms >= 0)
        return duration_ms;
    if (!started_at)
        return null;
    const start = Date.parse(started_at);
    if (Number.isNaN(start))
        return null;
    const endIso = completed_at;
    if (endIso) {
        const end = Date.parse(endIso);
        if (!Number.isNaN(end))
            return Math.max(0, end - start);
    }
    if (status === "running" || status === "queued") {
        return Math.max(0, Date.now() - start);
    }
    return null;
}
export function PlanDetailPanel({ taskId, nodeData, open, onClose, }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    const { data: task, isLoading } = useTaskQuery(taskId !== null && taskId !== void 0 ? taskId : "");
    const stop = useStopTaskMutation();
    const retry = useRetryTaskMutation();
    const approve = useApproveTaskMutation();
    const reject = useRejectTaskMutation();
    if (!open)
        return null;
    const status = String((_b = (_a = task === null || task === void 0 ? void 0 : task.status) !== null && _a !== void 0 ? _a : nodeData === null || nodeData === void 0 ? void 0 : nodeData.status) !== null && _b !== void 0 ? _b : "queued");
    const title = (_e = (_c = nodeData === null || nodeData === void 0 ? void 0 : nodeData.title) !== null && _c !== void 0 ? _c : (_d = task === null || task === void 0 ? void 0 : task.prompt) === null || _d === void 0 ? void 0 : _d.slice(0, 60)) !== null && _e !== void 0 ? _e : "Untitled";
    const agent = (_h = (_g = (_f = nodeData === null || nodeData === void 0 ? void 0 : nodeData.agentId) !== null && _f !== void 0 ? _f : nodeData === null || nodeData === void 0 ? void 0 : nodeData.agent_id) !== null && _g !== void 0 ? _g : task === null || task === void 0 ? void 0 : task.agent_id) !== null && _h !== void 0 ? _h : "—";
    const durationMs = computeDurationMs(task === null || task === void 0 ? void 0 : task.duration_ms, task === null || task === void 0 ? void 0 : task.started_at, task === null || task === void 0 ? void 0 : task.completed_at, status);
    const canStop = status === "queued" || status === "running";
    const canRetry = status === "failed" || status === "stopped" || status === "rejected";
    const needsApproval = status === "review";
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]", onClick: onClose }), _jsxs("aside", { className: [
                    "fixed right-0 top-0 z-50 flex h-full w-full max-w-[460px] flex-col",
                    "border-l border-border/50 bg-card",
                    "shadow-[-8px_0_24px_-4px_rgba(0,0,0,0.1)]",
                    "animate-in slide-in-from-right duration-200",
                ].join(" "), children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border/50 px-5 py-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-xs font-medium text-muted-foreground", children: "\u4EFB\u52A1\u8BE6\u60C5" }), _jsx("span", { className: `inline-flex h-2 w-2 rounded-full ${(_j = STATUS_COLOR[status]) !== null && _j !== void 0 ? _j : "bg-slate-400"}` }), _jsx("span", { className: "text-xs font-medium text-foreground", children: (_k = STATUS_LABEL[status]) !== null && _k !== void 0 ? _k : status })] }), _jsx("button", { onClick: onClose, className: "text-sm text-muted-foreground hover:text-foreground transition-smooth", children: "\u2715" })] }), _jsxs("div", { className: "flex-1 overflow-auto", children: [_jsxs("div", { className: "border-b border-border/50 px-5 py-4", children: [_jsx("div", { className: "text-[10px] font-medium text-muted-foreground", children: "\u6807\u9898" }), _jsx("h3", { className: "mt-1 text-base font-semibold leading-snug text-foreground", children: title })] }), _jsxs("div", { className: "grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border/50 px-5 py-4 text-sm", children: [_jsx(Field, { label: "\u5F00\u59CB\u65F6\u95F4", value: formatTime((_l = task === null || task === void 0 ? void 0 : task.started_at) !== null && _l !== void 0 ? _l : null) }), _jsx(Field, { label: "\u7ED3\u675F\u65F6\u95F4", value: formatTime((_m = task === null || task === void 0 ? void 0 : task.completed_at) !== null && _m !== void 0 ? _m : null) }), _jsx(Field, { label: "\u8017\u65F6", value: formatDuration(durationMs), mono: true }), _jsx(Field, { label: "\u521B\u5EFA\u65F6\u95F4", value: formatTime((_o = task === null || task === void 0 ? void 0 : task.created_at) !== null && _o !== void 0 ? _o : null) }), _jsx(Field, { label: "Agent", value: agent || "—", mono: true }), _jsx(Field, { label: "\u6A21\u578B", value: (_p = task === null || task === void 0 ? void 0 : task.model) !== null && _p !== void 0 ? _p : "—", mono: true }), _jsx(Field, { label: "\u9636\u6BB5", value: String((_q = nodeData === null || nodeData === void 0 ? void 0 : nodeData.phase) !== null && _q !== void 0 ? _q : 0), mono: true }), _jsx(Field, { label: "\u4F1A\u8BDD", value: (task === null || task === void 0 ? void 0 : task.session_id) ? task.session_id.slice(0, 8) : "—", mono: true })] }), isLoading ? (_jsx("div", { className: "px-5 py-8 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" })) : task ? (_jsxs(_Fragment, { children: [_jsx(Section, { title: "Prompt", children: _jsx("pre", { className: "whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 p-3 font-mono text-[12px] leading-relaxed text-foreground", children: task.prompt }) }), task.result && (_jsx(Section, { title: "\u8F93\u51FA", children: _jsx("pre", { className: "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-emerald-200", children: task.result }) })), task.diff_summary && (_jsx(Section, { title: "Diff \u6458\u8981", children: _jsx("pre", { className: "max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 p-3 font-mono text-[11px] text-foreground", children: task.diff_summary }) }))] })) : (_jsx("div", { className: "px-5 py-8 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u4EFB\u52A1\u8BE6\u60C5" }))] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 border-t border-border/50 bg-muted/30 px-5 py-3", children: [needsApproval && task && (_jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", disabled: approve.isPending, onClick: () => approve.mutate(task.id), children: "\u2713 \u6279\u51C6" }), _jsx(Button, { size: "sm", variant: "destructive", disabled: reject.isPending, onClick: () => reject.mutate({ id: task.id }), children: "\u2715 \u62D2\u7EDD" })] })), canStop && task && (_jsx(Button, { size: "sm", variant: "destructive", disabled: stop.isPending, onClick: () => stop.mutate(task.id), children: "\u25A0 \u505C\u6B62" })), canRetry && task && (_jsx(Button, { size: "sm", variant: "outline", disabled: retry.isPending, onClick: () => retry.mutate(task.id), children: "\u21BB \u91CD\u8BD5" })), _jsxs("span", { className: "ml-auto text-[10px] text-muted-foreground", children: ["ID \u00B7 ", (_s = (_r = task === null || task === void 0 ? void 0 : task.id) === null || _r === void 0 ? void 0 : _r.slice(0, 8)) !== null && _s !== void 0 ? _s : "—"] })] })] })] }));
}
function Field({ label, value, mono, }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "text-[10px] font-medium text-muted-foreground", children: label }), _jsx("div", { className: `mt-0.5 truncate text-foreground ${mono ? "font-mono text-[12px]" : "text-[13px]"}`, children: value })] }));
}
function Section({ title, children, }) {
    return (_jsxs("div", { className: "border-b border-border/50 px-5 py-4", children: [_jsx("div", { className: "mb-2 text-[10px] font-medium text-muted-foreground", children: title }), children] }));
}
//# sourceMappingURL=PlanDetailPanel.js.map