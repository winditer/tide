"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { Badge, cn } from "@tide/ui";
import { Draggable } from "@hello-pangea/dnd";
const STATUS_CONFIG = {
    pending: { label: "待操作", color: "bg-gray-100 text-gray-700 border border-gray-200" },
    in_progress: { label: "进行中", color: "bg-blue-100 text-blue-700 border border-blue-200" },
    pending_approval: { label: "待审批", color: "bg-amber-100 text-amber-700 border border-amber-200" },
    completed: { label: "已完成", color: "bg-green-100 text-green-700 border border-green-200" },
    failed: { label: "失败", color: "bg-red-100 text-red-700 border border-red-200" },
    stopped: { label: "已停止", color: "bg-gray-200 text-gray-600 border border-gray-300" },
    waiting: { label: "等待中", color: "bg-purple-100 text-purple-700 border border-purple-200" },
};
const PRIORITY_CONFIG = {
    0: { label: "无", color: "bg-muted text-muted-foreground" },
    1: { label: "低", color: "bg-blue-50 text-blue-700 border border-blue-200" },
    2: { label: "中", color: "bg-amber-50 text-amber-700 border border-amber-200" },
    3: { label: "高", color: "bg-orange-50 text-orange-700 border border-orange-200" },
    4: { label: "紧急", color: "bg-rose-50 text-rose-700 border border-rose-200" },
};
/** 卡片左侧色条：根据优先级映射到边框颜色 */
const PRIORITY_BORDER = {
    0: "border-l-transparent",
    1: "border-l-gray-300",
    2: "border-l-blue-400",
    3: "border-l-orange-400",
    4: "border-l-red-500",
};
/** 滞留预警阈值（天） */
const STALE_DAYS_THRESHOLD = 3;
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
export function WorkItemCard({ item, index, onClick, completed = false, versionMap, draggable = true, }) {
    var _a, _b, _c;
    const priorityCfg = (_a = PRIORITY_CONFIG[item.priority]) !== null && _a !== void 0 ? _a : PRIORITY_CONFIG[0];
    const priorityBorder = (_c = PRIORITY_BORDER[(_b = item.priority) !== null && _b !== void 0 ? _b : 0]) !== null && _c !== void 0 ? _c : PRIORITY_BORDER[0];
    // 多重防护：列为 end / status 已完成 / 已有 completed_at 的工作项均禁止拖动
    const isCompleted = completed || item.status === "completed" || !!item.completed_at;
    // 滞留天数：基于 updated_at（缺失时回退 created_at）
    const daysSinceUpdate = useMemo(() => {
        const ref = item.updated_at || item.created_at;
        if (!ref)
            return 0;
        const t = new Date(ref).getTime();
        if (Number.isNaN(t))
            return 0;
        return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
    }, [item.updated_at, item.created_at]);
    // 已完成的工作项不算滞留
    const isStale = !isCompleted && daysSinceUpdate >= STALE_DAYS_THRESHOLD;
    const versionName = item.version_id && versionMap ? versionMap[item.version_id] : undefined;
    const isDragDisabled = isCompleted || !draggable;
    /** 卡片内容（提取为内部渲染，避免 draggable/non-draggable 两处重复） */
    const cardContent = (isDragging = false) => {
        var _a, _b, _c, _d, _e;
        return (_jsxs("div", { onClick: () => onClick === null || onClick === void 0 ? void 0 : onClick(item), role: onClick ? "button" : undefined, tabIndex: onClick ? 0 : undefined, className: cn("group relative rounded-lg border border-l-4 p-3 shadow-card transition-smooth", priorityBorder, isCompleted
                ? "border-emerald-200/80 bg-emerald-50/60 opacity-90"
                : isStale
                    ? "border-amber-200 bg-amber-50/70 ring-1 ring-amber-200/60"
                    : "border-border/50 bg-card", isDragging
                ? "shadow-card-hover ring-2 ring-primary/30 -rotate-1"
                : onClick
                    ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-card-hover"
                    : "", !isCompleted && !isStale && onClick && !isDragging
                ? "hover:border-primary/30"
                : ""), children: [item.status && !isCompleted && (_jsx("span", { className: `absolute right-2 top-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${(_b = (_a = STATUS_CONFIG[item.status]) === null || _a === void 0 ? void 0 : _a.color) !== null && _b !== void 0 ? _b : "bg-gray-100 text-gray-700"}`, children: (_d = (_c = STATUS_CONFIG[item.status]) === null || _c === void 0 ? void 0 : _c.label) !== null && _d !== void 0 ? _d : item.status })), isCompleted && (_jsxs("span", { className: "absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700", children: [_jsx("span", { className: "h-1.5 w-1.5 rounded-full bg-emerald-500" }), "DONE"] })), _jsx("div", { className: `mb-2 line-clamp-2 pr-12 text-sm font-medium leading-snug ${isCompleted
                        ? "text-emerald-900/70 line-through decoration-emerald-600/40"
                        : "text-foreground"}`, children: item.title || "(无标题)" }), _jsxs("div", { className: "flex flex-wrap items-center gap-1.5", children: [item.priority > 0 && (_jsx("span", { className: `inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priorityCfg.color}`, children: priorityCfg.label })), versionName && (_jsx("span", { className: "inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 border border-indigo-100", children: versionName })), ((_e = item.tags) !== null && _e !== void 0 ? _e : []).slice(0, 3).map((tag) => (_jsx(Badge, { variant: "outline", className: "rounded-md border-border/60 text-[10px] text-muted-foreground", children: tag }, tag)))] }), _jsxs("div", { className: "mt-2.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground", children: [item.assignee ? (_jsxs("span", { className: "flex items-center gap-1.5 truncate", children: [_jsx("span", { className: "flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold uppercase text-primary", children: item.assignee.slice(0, 1) }), _jsx("span", { className: "truncate", children: item.assignee })] })) : (_jsx("span", {})), isStale ? (_jsxs("span", { className: "shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-700", title: `已 ${daysSinceUpdate} 天未更新`, children: [_jsx("span", { className: "h-1 w-1 rounded-full bg-amber-500" }), "\u6EDE\u7559 ", daysSinceUpdate, " \u5929"] })) : item.updated_at ? (_jsx("span", { className: "shrink-0 tabular-nums", children: formatTime(item.updated_at) })) : null] })] }));
    };
    // 非拖拽模式：直接渲染卡片，不需要 DragDropContext
    if (!draggable) {
        return cardContent(false);
    }
    // 拖拽模式：用 Draggable 包裹
    return (_jsx(Draggable, { draggableId: item.id, index: index, isDragDisabled: isDragDisabled, children: (provided, snapshot) => (_jsx("div", Object.assign({ ref: provided.innerRef }, provided.draggableProps, provided.dragHandleProps, { style: provided.draggableProps.style, children: cardContent(snapshot.isDragging) }))) }));
}
//# sourceMappingURL=WorkItemCard.js.map