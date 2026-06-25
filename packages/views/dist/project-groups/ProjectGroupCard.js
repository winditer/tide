"use client";
import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Card, CardContent, Badge } from "@tide/ui";
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
/**
 * 项目组卡片：展示组名、描述、成员数量与基本元信息。
 * 视觉与 ProjectsPage 的项目卡片保持一致（Card + shadow-card）。
 */
export function ProjectGroupCard({ group, onClick, onDelete, isDeleting, }) {
    return (_jsx(Card, { className: "group relative bg-card rounded-xl shadow-card transition-smooth hover:shadow-card-hover hover:border-blue-500/40 cursor-pointer", onClick: () => onClick === null || onClick === void 0 ? void 0 : onClick(group), children: _jsxs(CardContent, { className: "p-5", children: [_jsxs("div", { className: "mb-3 flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "text-xs text-muted-foreground", children: ["GROUP \u00B7 ", group.workspace_id || "default"] }), _jsx("h3", { className: "mt-1 truncate text-lg font-semibold tracking-tight", children: group.name })] }), _jsxs(Badge, { variant: "secondary", children: [group.member_count, " \u4E2A\u9879\u76EE"] })] }), group.description ? (_jsx("p", { className: "mb-4 line-clamp-2 text-sm text-muted-foreground", children: group.description })) : (_jsx("p", { className: "mb-4 text-sm italic text-muted-foreground/70", children: "\u672A\u586B\u5199\u63CF\u8FF0" })), _jsxs("div", { className: "flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground", children: [_jsx("span", { className: "font-mono", children: formatTime(group.created_at) }), group.created_by && (_jsx("span", { className: "rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", children: group.created_by }))] }), onDelete && (_jsx("button", { type: "button", disabled: isDeleting, onClick: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(group);
                    }, className: "absolute right-2 top-2 rounded-md border border-border bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-smooth hover:border-destructive hover:text-destructive group-hover:opacity-100 disabled:opacity-50", children: isDeleting ? "…" : "删除" }))] }) }));
}
//# sourceMappingURL=ProjectGroupCard.js.map