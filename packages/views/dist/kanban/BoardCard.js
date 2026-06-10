"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "@tide/ui";
import { Draggable } from "@hello-pangea/dnd";
import { useRouter } from "next/navigation";
const STATUS_VARIANT = {
    queued: "secondary",
    pending: "secondary",
    running: "default",
    active: "default",
    review: "outline",
    completed: "secondary",
    failed: "destructive",
    stopped: "outline",
    idle: "outline",
    archived: "outline",
};
function formatTime(iso) {
    if (!iso)
        return "";
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
function shortenCwd(cwd) {
    if (!cwd)
        return null;
    const parts = cwd.split("/").filter(Boolean);
    if (parts.length === 0)
        return cwd;
    return parts[parts.length - 1];
}
function resolveHref(card) {
    var _a;
    const meta = (_a = card.metadata) !== null && _a !== void 0 ? _a : {};
    switch (card.type) {
        case "task":
        case "session":
            return card.id ? `/tasks/${card.id}` : null;
        case "workflow_node": {
            const wf = meta.workflow_id;
            const run = meta.run_id;
            if (wf && run)
                return `/workflows/${wf}/runs/${run}`;
            if (wf)
                return `/workflows/${wf}`;
            return null;
        }
        case "project":
            // 项目目前无独立详情页，跳到项目列表
            return "/projects";
        default:
            return null;
    }
}
export function BoardCard({ card, index }) {
    var _a;
    const router = useRouter();
    const href = resolveHref(card);
    const meta = (_a = card.metadata) !== null && _a !== void 0 ? _a : {};
    const cwd = shortenCwd(meta.cwd);
    const agentId = meta.agent_id;
    const handleClick = (e) => {
        if (!href)
            return;
        // 避免与拖拽冲突：仅响应主键点击
        if (e.button !== 0)
            return;
        router.push(href);
    };
    return (_jsx(Draggable, { draggableId: card.id, index: index, children: (provided, snapshot) => {
            var _a;
            return (_jsxs("div", Object.assign({ ref: provided.innerRef }, provided.draggableProps, provided.dragHandleProps, { onClick: handleClick, role: href ? "button" : undefined, tabIndex: href ? 0 : undefined, className: `group rounded-lg border bg-card p-3 shadow-sm transition-all ${snapshot.isDragging
                    ? "shadow-md ring-2 ring-primary/20"
                    : href
                        ? "cursor-pointer hover:border-primary/40 hover:shadow-md"
                        : ""}`, children: [_jsx("div", { className: "mb-1.5 line-clamp-2 text-sm font-medium leading-snug text-foreground", children: card.title || "(无标题)" }), _jsxs("div", { className: "flex flex-wrap items-center gap-1.5", children: [_jsx(Badge, { variant: (_a = STATUS_VARIANT[card.status]) !== null && _a !== void 0 ? _a : "outline", className: "text-[10px] uppercase tracking-wide", children: card.status }), agentId && (_jsx(Badge, { variant: "outline", className: "text-[10px]", children: agentId })), meta.workflow_name && (_jsx(Badge, { variant: "outline", className: "text-[10px]", children: meta.workflow_name }))] }), (cwd || card.updated_at) && (_jsxs("div", { className: "mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground", children: [cwd ? (_jsx("span", { className: "truncate", title: meta.cwd, children: cwd })) : (_jsx("span", {})), card.updated_at && (_jsx("span", { className: "shrink-0", children: formatTime(card.updated_at) }))] })), meta.error && (_jsx("div", { className: "mt-2 truncate rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive", title: String(meta.error), children: String(meta.error) }))] })));
        } }));
}
//# sourceMappingURL=BoardCard.js.map