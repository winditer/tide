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
    if (ms == null)
        return "—";
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
        return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
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
    const canStop = status === "queued" || status === "running";
    const canRetry = status === "failed" || status === "stopped" || status === "rejected";
    const needsApproval = status === "review";
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]", onClick: onClose }), _jsxs("aside", { className: [
                    "fixed right-0 top-0 z-50 flex h-full w-full max-w-[460px] flex-col",
                    "border-l-2 border-zinc-900 bg-white",
                    "shadow-[-12px_0_0_0_rgba(24,24,27,0.04)]",
                    "animate-in slide-in-from-right duration-200",
                ].join(" "), children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-900 bg-zinc-950 px-5 py-4 text-white", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-mono text-[10px] tracking-[0.3em] text-zinc-400", children: "TASK / NODE" }), _jsx("span", { className: `inline-flex h-2 w-2 ${(_j = STATUS_COLOR[status]) !== null && _j !== void 0 ? _j : "bg-slate-400"}` }), _jsx("span", { className: "font-mono text-[11px] uppercase tracking-widest", children: (_k = STATUS_LABEL[status]) !== null && _k !== void 0 ? _k : status })] }), _jsx("button", { onClick: onClose, className: "font-mono text-sm text-zinc-300 hover:text-white", children: "\u2715" })] }), _jsxs("div", { className: "flex-1 overflow-auto", children: [_jsxs("div", { className: "border-b border-dashed border-zinc-300 px-5 py-4", children: [_jsx("div", { className: "font-mono text-[10px] tracking-widest text-zinc-500", children: "TITLE" }), _jsx("h3", { className: "mt-1 text-base font-bold leading-snug text-zinc-900", children: title })] }), _jsxs("div", { className: "grid grid-cols-2 gap-x-4 gap-y-3 border-b border-dashed border-zinc-300 px-5 py-4 text-sm", children: [_jsx(Field, { label: "AGENT", value: agent || "—", mono: true }), _jsx(Field, { label: "MODEL", value: (_l = task === null || task === void 0 ? void 0 : task.model) !== null && _l !== void 0 ? _l : "—", mono: true }), _jsx(Field, { label: "DURATION", value: formatDuration((_m = task === null || task === void 0 ? void 0 : task.duration_ms) !== null && _m !== void 0 ? _m : null), mono: true }), _jsx(Field, { label: "PHASE", value: String((_o = nodeData === null || nodeData === void 0 ? void 0 : nodeData.phase) !== null && _o !== void 0 ? _o : 0), mono: true }), _jsx(Field, { label: "STARTED", value: formatTime((_p = task === null || task === void 0 ? void 0 : task.started_at) !== null && _p !== void 0 ? _p : null) }), _jsx(Field, { label: "COMPLETED", value: formatTime((_q = task === null || task === void 0 ? void 0 : task.completed_at) !== null && _q !== void 0 ? _q : null) })] }), isLoading ? (_jsx("div", { className: "px-5 py-8 text-center font-mono text-xs text-zinc-500", children: "\u25D0 LOADING\u2026" })) : task ? (_jsxs(_Fragment, { children: [_jsx(Section, { title: "PROMPT", children: _jsx("pre", { className: "whitespace-pre-wrap break-words rounded-sm border border-zinc-200 bg-zinc-50 p-3 font-mono text-[12px] leading-relaxed text-zinc-800", children: task.prompt }) }), task.result && (_jsx(Section, { title: "OUTPUT", children: _jsx("pre", { className: "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-zinc-200 bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-emerald-200", children: task.result }) })), task.diff_summary && (_jsx(Section, { title: "DIFF SUMMARY", children: _jsx("pre", { className: "max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] text-zinc-700", children: task.diff_summary }) }))] })) : (_jsx("div", { className: "px-5 py-8 text-center font-mono text-xs text-zinc-500", children: "\u25C7 NO TASK DETAILS" }))] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 border-t border-zinc-900 bg-zinc-50 px-5 py-3", children: [needsApproval && task && (_jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", disabled: approve.isPending, onClick: () => approve.mutate(task.id), children: "\u2713 \u6279\u51C6" }), _jsx(Button, { size: "sm", variant: "destructive", disabled: reject.isPending, onClick: () => reject.mutate({ id: task.id }), children: "\u2715 \u62D2\u7EDD" })] })), canStop && task && (_jsx(Button, { size: "sm", variant: "destructive", disabled: stop.isPending, onClick: () => stop.mutate(task.id), children: "\u25A0 \u505C\u6B62" })), canRetry && task && (_jsx(Button, { size: "sm", variant: "outline", disabled: retry.isPending, onClick: () => retry.mutate(task.id), children: "\u21BB \u91CD\u8BD5" })), _jsxs("span", { className: "ml-auto font-mono text-[10px] tracking-widest text-zinc-400", children: ["ID \u00B7 ", (_s = (_r = task === null || task === void 0 ? void 0 : task.id) === null || _r === void 0 ? void 0 : _r.slice(0, 8)) !== null && _s !== void 0 ? _s : "—"] })] })] })] }));
}
function Field({ label, value, mono, }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "font-mono text-[10px] tracking-widest text-zinc-500", children: label }), _jsx("div", { className: `mt-0.5 truncate text-zinc-900 ${mono ? "font-mono text-[12px]" : "text-[13px]"}`, children: value })] }));
}
function Section({ title, children, }) {
    return (_jsxs("div", { className: "border-b border-dashed border-zinc-300 px-5 py-4", children: [_jsx("div", { className: "mb-2 font-mono text-[10px] tracking-widest text-zinc-500", children: title }), children] }));
}
//# sourceMappingURL=PlanDetailPanel.js.map