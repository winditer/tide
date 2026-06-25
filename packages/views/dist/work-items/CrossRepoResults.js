"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import Link from "next/link";
import { GitCommit, ChevronRight, Copy, Check } from "lucide-react";
import { Badge } from "@tide/ui";
import { useWorkItemCrossRepoResults, } from "@tide/core";
export function CrossRepoResults({ workItemId, enabled = true }) {
    var _a;
    const { data, isLoading } = useWorkItemCrossRepoResults(enabled && workItemId ? workItemId : undefined);
    // 非项目组工作项 / 未生成 Plan / 后端返回空 → 不渲染
    if (!enabled)
        return null;
    if (isLoading)
        return null;
    const results = (_a = data === null || data === void 0 ? void 0 : data.results) !== null && _a !== void 0 ? _a : [];
    if (!data || !data.group_id || results.length === 0) {
        return null;
    }
    return (_jsxs("div", { children: [_jsxs("div", { className: "mb-3 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs font-medium uppercase tracking-wider text-muted-foreground", children: "\u8DE8\u4ED3\u5E93\u6267\u884C\u7ED3\u679C" }), _jsxs(Badge, { variant: "outline", className: "rounded-md border-primary/30 bg-primary/5 text-[10px] text-primary", children: [results.length, " \u4E2A\u4ED3\u5E93"] })] }), data.plan_id && (_jsx(Link, { href: `/plans/${data.plan_id}`, className: "text-[11px] font-medium text-primary transition-smooth hover:text-primary/80 hover:underline", children: "\u67E5\u770B Plan \u2197" }))] }), _jsx("div", { className: "space-y-2", children: results.map((item) => (_jsx(RepoResultCard, { item: item }, item.task_id))) })] }));
}
function RepoResultCard({ item }) {
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const hasDiff = !!(item.diff_summary && item.diff_summary.trim().length > 0);
    const expandable = hasDiff;
    const shortHash = item.commit_hash ? item.commit_hash.slice(0, 7) : null;
    const projectName = item.project_name || (item.cwd ? item.cwd.split("/").pop() : null) || "未知仓库";
    const handleCopyHash = async (e) => {
        e.stopPropagation();
        if (!item.commit_hash)
            return;
        try {
            await navigator.clipboard.writeText(item.commit_hash);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
        catch (_a) {
            // 忽略复制失败
        }
    };
    return (_jsxs("div", { className: "group rounded-lg border border-border/50 bg-card shadow-card transition-smooth hover:shadow-card-hover", children: [_jsxs("button", { type: "button", onClick: () => expandable && setExpanded((v) => !v), className: `flex w-full items-center gap-3 px-3 py-2.5 text-left ${expandable ? "cursor-pointer" : "cursor-default"}`, "aria-expanded": expanded, children: [_jsxs("div", { className: "flex min-w-0 flex-1 items-center gap-2.5", children: [_jsx(StatusDot, { status: item.status }), _jsx("span", { className: "truncate text-sm font-medium text-foreground", children: projectName }), _jsx(StatusBadge, { status: item.status })] }), shortHash && (_jsxs("span", { role: "button", tabIndex: 0, onClick: handleCopyHash, onKeyDown: (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleCopyHash(e);
                            }
                        }, className: "flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground transition-smooth hover:border-primary/40 hover:bg-primary/5 hover:text-primary", title: `点击复制完整 hash: ${item.commit_hash}`, children: [_jsx(GitCommit, { className: "h-3 w-3" }), shortHash, copied ? (_jsx(Check, { className: "h-3 w-3 text-emerald-500" })) : (_jsx(Copy, { className: "h-3 w-3 opacity-0 transition-smooth group-hover:opacity-60" }))] })), _jsx(Link, { href: `/tasks/${item.task_id}`, onClick: (e) => e.stopPropagation(), className: "shrink-0 text-[11px] font-medium text-primary opacity-0 transition-smooth hover:underline group-hover:opacity-100", children: "\u4EFB\u52A1 \u2192" }), expandable && (_jsx(ChevronRight, { className: `h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}` }))] }), expandable && expanded && (_jsxs("div", { className: "border-t border-border/40 bg-muted/20 px-3 py-3", children: [item.commit_message && (_jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground", children: "Commit Message" }), _jsx("p", { className: "rounded-md border-l-2 border-primary/40 bg-background/70 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/90", children: item.commit_message })] })), hasDiff && (_jsxs("div", { children: [_jsx("div", { className: "mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground", children: "Diff Summary" }), _jsx("pre", { className: "max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border/40 bg-zinc-950 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-100", children: item.diff_summary })] })), item.cwd && (_jsx("div", { className: "mt-2 truncate font-mono text-[10px] text-muted-foreground/70", children: item.cwd }))] })), !expanded && !hasDiff && item.commit_message && (_jsx("div", { className: "border-t border-border/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground", children: item.commit_message }))] }));
}
function StatusDot({ status }) {
    const tone = mapStatusTone(status);
    return (_jsx("span", { className: `relative flex h-2 w-2 shrink-0 items-center justify-center rounded-full ${tone.dotBg}`, "aria-hidden": true, children: tone.pulse && (_jsx("span", { className: `absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone.dotBg}` })) }));
}
function StatusBadge({ status }) {
    if (!status)
        return null;
    const tone = mapStatusTone(status);
    return (_jsx(Badge, { variant: "outline", className: `shrink-0 rounded-md text-[10px] ${tone.badgeBorder} ${tone.badgeText} ${tone.badgeBg}`, children: tone.label }));
}
function mapStatusTone(status) {
    switch ((status || "").toLowerCase()) {
        case "completed":
        case "success":
        case "done":
            return {
                label: "已完成",
                pulse: false,
                dotBg: "bg-emerald-500",
                badgeBorder: "border-emerald-200",
                badgeBg: "bg-emerald-50",
                badgeText: "text-emerald-700",
            };
        case "running":
        case "in_progress":
            return {
                label: "进行中",
                pulse: true,
                dotBg: "bg-sky-500",
                badgeBorder: "border-sky-200",
                badgeBg: "bg-sky-50",
                badgeText: "text-sky-700",
            };
        case "failed":
        case "error":
            return {
                label: "失败",
                pulse: false,
                dotBg: "bg-rose-500",
                badgeBorder: "border-rose-200",
                badgeBg: "bg-rose-50",
                badgeText: "text-rose-700",
            };
        case "stopped":
        case "cancelled":
            return {
                label: "已停止",
                pulse: false,
                dotBg: "bg-zinc-400",
                badgeBorder: "border-zinc-200",
                badgeBg: "bg-zinc-50",
                badgeText: "text-zinc-600",
            };
        case "pending_approval":
        case "approving":
            return {
                label: "待审批",
                pulse: true,
                dotBg: "bg-amber-500",
                badgeBorder: "border-amber-200",
                badgeBg: "bg-amber-50",
                badgeText: "text-amber-700",
            };
        case "queued":
        case "pending":
        default:
            return {
                label: status || "排队中",
                pulse: false,
                dotBg: "bg-zinc-300",
                badgeBorder: "border-border/60",
                badgeBg: "bg-muted/40",
                badgeText: "text-muted-foreground",
            };
    }
}
//# sourceMappingURL=CrossRepoResults.js.map