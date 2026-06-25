"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useMemo } from "react";
import { DragDropContext, Droppable } from "@hello-pangea/dnd";
import { Badge } from "@tide/ui";
import { useWorkItemBoard, useMoveWorkItem, } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { WorkItemCard } from "./WorkItemCard";
const CATEGORY_COLORS = {
    todo: {
        ring: "border-zinc-200",
        dot: "bg-zinc-400",
        tint: "bg-muted/30",
    },
    in_progress: {
        ring: "border-blue-200/70",
        dot: "bg-blue-500",
        tint: "bg-blue-50/40",
    },
    review: {
        ring: "border-amber-200/70",
        dot: "bg-amber-500",
        tint: "bg-amber-50/40",
    },
    done: {
        ring: "border-emerald-200/70",
        dot: "bg-emerald-500",
        tint: "bg-emerald-50/40",
    },
    custom: {
        ring: "border-violet-200/70",
        dot: "bg-violet-500",
        tint: "bg-violet-50/40",
    },
};
const PRIORITY_LANE_LABELS = {
    "0": "未指定优先级",
    "1": "低优先级",
    "2": "中优先级",
    "3": "高优先级",
    "4": "紧急",
};
const PRIORITY_LANE_ORDER = ["4", "3", "2", "1", "0"];
function getColumnPalette(column) {
    var _a, _b;
    const isEnd = column.node_type === "end";
    if (isEnd) {
        return {
            ring: "border-emerald-300/70",
            dot: "bg-emerald-500",
            tint: "bg-emerald-50/60",
        };
    }
    return ((_b = CATEGORY_COLORS[(_a = column.category) !== null && _a !== void 0 ? _a : "custom"]) !== null && _b !== void 0 ? _b : CATEGORY_COLORS.custom);
}
export function WorkItemBoard({ projectId, versionId, onCardClick, versionMap, groupBy = "none", refetchInterval, }) {
    var _a;
    const { data, isLoading, isError } = useWorkItemBoard(projectId, versionId, refetchInterval);
    const moveMutation = useMoveWorkItem();
    const queryClient = useQueryClient();
    const handleDragEnd = useCallback((result) => {
        const { draggableId, destination, source } = result;
        if (!destination || destination.droppableId === source.droppableId)
            return;
        const targetNodeId = destination.droppableId;
        const sourceNodeId = source.droppableId;
        // 防护：不允许从 end 列拖出（已完成状态不应该被手动重置）
        const sourceColumn = data === null || data === void 0 ? void 0 : data.columns.find((c) => c.id === sourceNodeId);
        if ((sourceColumn === null || sourceColumn === void 0 ? void 0 : sourceColumn.node_type) === "end")
            return;
        // 防护：不允许拖拽到 end 列（已完成状态不应该手动进入）
        const destColumn = data === null || data === void 0 ? void 0 : data.columns.find((c) => c.id === targetNodeId);
        if ((destColumn === null || destColumn === void 0 ? void 0 : destColumn.node_type) === "end")
            return;
        // Optimistic update
        queryClient.setQueryData(["work-items", "board", projectId, versionId !== null && versionId !== void 0 ? versionId : null], (old) => {
            if (!(old === null || old === void 0 ? void 0 : old.columns))
                return old;
            let movedItem;
            const columns = old.columns.map((col) => {
                const filtered = col.items.filter((item) => {
                    if (item.id === draggableId) {
                        movedItem = item;
                        return false;
                    }
                    return true;
                });
                return Object.assign(Object.assign({}, col), { items: filtered });
            });
            if (movedItem) {
                const destCol = columns.find((col) => col.id === targetNodeId);
                if (destCol) {
                    destCol.items.splice(destination.index, 0, Object.assign(Object.assign({}, movedItem), { current_node_id: targetNodeId }));
                }
            }
            return Object.assign(Object.assign({}, old), { columns });
        });
        moveMutation.mutate({ id: draggableId, targetNodeId }, {
            onSettled: () => {
                // 无论成败都刷新看板，确保 status / current_node_id 与后端一致
                queryClient.invalidateQueries({
                    queryKey: ["work-items", "board", projectId, versionId !== null && versionId !== void 0 ? versionId : null],
                });
            },
        });
    }, [moveMutation, queryClient, projectId, versionId, data]);
    const columns = (_a = data === null || data === void 0 ? void 0 : data.columns) !== null && _a !== void 0 ? _a : [];
    // 扁平化所有工作项（用于泳道分组）
    const allItems = useMemo(() => {
        const arr = [];
        columns.forEach((col) => col.items.forEach((it) => arr.push(it)));
        return arr;
    }, [columns]);
    // 计算泳道
    const swimlanes = useMemo(() => {
        if (groupBy === "none")
            return null;
        const groups = new Map();
        allItems.forEach((item) => {
            var _a, _b;
            let key;
            if (groupBy === "assignee") {
                key = ((_a = item.assignee) === null || _a === void 0 ? void 0 : _a.trim()) || "未分配";
            }
            else if (groupBy === "priority") {
                key = String((_b = item.priority) !== null && _b !== void 0 ? _b : 0);
            }
            else {
                // version
                key = item.version_id || "__no_version__";
            }
            if (!groups.has(key))
                groups.set(key, []);
            groups.get(key).push(item);
        });
        let entries = Array.from(groups.entries());
        if (groupBy === "priority") {
            entries.sort((a, b) => PRIORITY_LANE_ORDER.indexOf(a[0]) -
                PRIORITY_LANE_ORDER.indexOf(b[0]));
        }
        else {
            entries.sort((a, b) => {
                // 把"未分配/无版本"放最后
                const aIsFallback = a[0] === "未分配" || a[0] === "__no_version__";
                const bIsFallback = b[0] === "未分配" || b[0] === "__no_version__";
                if (aIsFallback && !bIsFallback)
                    return 1;
                if (!aIsFallback && bIsFallback)
                    return -1;
                return a[0].localeCompare(b[0]);
            });
        }
        return entries.map(([key, items]) => {
            var _a;
            let label;
            if (groupBy === "priority") {
                label = (_a = PRIORITY_LANE_LABELS[key]) !== null && _a !== void 0 ? _a : key;
            }
            else if (groupBy === "version") {
                label =
                    key === "__no_version__"
                        ? "无版本"
                        : (versionMap === null || versionMap === void 0 ? void 0 : versionMap[key]) || key;
            }
            else {
                label = key;
            }
            return { key, label, items };
        });
    }, [groupBy, allItems, versionMap]);
    if (isLoading) {
        return (_jsx("div", { className: "py-16 text-center text-sm text-muted-foreground", children: "\u52A0\u8F7D\u770B\u677F\u4E2D\u2026" }));
    }
    if (isError) {
        return (_jsx("div", { className: "py-16 text-center text-sm text-destructive", children: "\u770B\u677F\u52A0\u8F7D\u5931\u8D25" }));
    }
    if (columns.length === 0) {
        return (_jsxs("div", { className: "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40 py-16 text-center shadow-card", children: [_jsx("div", { className: "text-xs uppercase tracking-[0.3em] text-muted-foreground", children: "NO WORKFLOW BOUND" }), _jsx("p", { className: "mt-3 text-base font-medium text-foreground", children: "\u8BE5\u9879\u76EE\u5C1A\u672A\u7ED1\u5B9A\u5DE5\u4F5C\u6D41\uFF0C\u8BF7\u5148\u914D\u7F6E\u5DE5\u4F5C\u6D41" })] }));
    }
    // ============================================================
    // 泳道模式：按 groupBy 分组横向展示，每个泳道内仍按列布局
    // 为简化交互，泳道模式下禁用拖拽（仅展示）
    // ============================================================
    if (swimlanes) {
        return (_jsxs("div", { className: "space-y-6", children: [swimlanes.length === 0 && (_jsx("div", { className: "py-12 text-center text-sm text-muted-foreground", children: "\u5F53\u524D\u6761\u4EF6\u4E0B\u6CA1\u6709\u53EF\u5206\u7EC4\u7684\u5DE5\u4F5C\u9879" })), swimlanes.map((lane) => (_jsxs("section", { className: "rounded-xl border border-border/60 bg-card/40 p-3", children: [_jsxs("header", { className: "mb-3 flex items-center justify-between px-1", children: [_jsxs("h4", { className: "flex items-center gap-2 text-sm font-semibold text-foreground", children: [_jsx("span", { className: "inline-block h-2 w-2 rounded-full bg-primary/70" }), lane.label, _jsxs("span", { className: "text-xs font-normal text-muted-foreground", children: ["(", lane.items.length, ")"] })] }), _jsx("span", { className: "text-[10px] uppercase tracking-wider text-muted-foreground", children: "\u53EA\u8BFB\u6A21\u5F0F" })] }), _jsx("div", { className: "flex gap-4 overflow-x-auto pb-2", children: columns.map((column) => {
                                const isEnd = column.node_type === "end";
                                const palette = getColumnPalette(column);
                                const colItems = lane.items.filter((it) => it.current_node_id === column.id);
                                return (_jsxs("div", { className: `flex flex-1 min-w-[220px] flex-col rounded-xl border ${palette.ring} ${palette.tint} p-3`, children: [_jsxs("div", { className: "mb-2 flex items-center justify-between px-1", children: [_jsxs("h3", { className: "flex items-center gap-2 text-xs font-semibold tracking-tight text-foreground", children: [_jsx("span", { "aria-hidden": true, className: `inline-block h-1.5 w-1.5 rounded-full ${palette.dot}` }), _jsx("span", { children: column.label })] }), _jsx(Badge, { variant: "secondary", className: "rounded-full bg-background/80 px-2 text-[10px] font-medium", children: colItems.length })] }), _jsxs("div", { className: "flex flex-1 flex-col gap-2 rounded-lg p-1", children: [colItems.map((item, index) => (_jsx(WorkItemCard, { item: item, index: index, onClick: onCardClick, completed: isEnd, versionMap: versionMap, draggable: false }, item.id))), colItems.length === 0 && (_jsx("div", { className: "py-3 text-center text-[10px] text-muted-foreground/60", children: "\u2014" }))] })] }, `${lane.key}-${column.id}`));
                            }) })] }, lane.key)))] }));
    }
    // ============================================================
    // 默认看板模式：支持拖拽流转
    // ============================================================
    return (_jsx(DragDropContext, { onDragEnd: handleDragEnd, children: _jsx("div", { className: "flex gap-5 overflow-x-auto pb-4", children: columns.map((column) => {
                const isEnd = column.node_type === "end";
                const palette = getColumnPalette(column);
                return (_jsxs("div", { className: `flex flex-1 min-w-[220px] flex-col rounded-xl border ${palette.ring} ${palette.tint} p-3 transition-smooth`, children: [_jsxs("div", { className: "mb-3 flex items-center justify-between px-1", children: [_jsxs("h3", { className: "flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground", children: [_jsx("span", { "aria-hidden": true, className: `inline-block h-2 w-2 rounded-full ${palette.dot}` }), _jsx("span", { children: column.label }), _jsxs("span", { className: "text-xs font-normal text-muted-foreground", children: ["(", column.items.length, ")"] }), isEnd && (_jsx("span", { className: "ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white", children: "\u2713" }))] }), _jsx(Badge, { variant: "secondary", className: "rounded-full bg-background/80 px-2 text-[11px] font-medium", children: column.items.length })] }), _jsx(Droppable, { droppableId: column.id, isDropDisabled: isEnd, children: (provided, snapshot) => (_jsxs("div", Object.assign({ ref: provided.innerRef }, provided.droppableProps, { className: `flex min-h-[160px] flex-1 flex-col gap-3 rounded-lg p-1 transition-smooth ${snapshot.isDraggingOver
                                    ? "bg-emerald-50/60 ring-1 ring-emerald-300/60"
                                    : ""}`, children: [column.items.map((item, index) => (_jsx(WorkItemCard, { item: item, index: index, onClick: onCardClick, completed: isEnd, versionMap: versionMap }, item.id))), provided.placeholder] }))) })] }, column.id));
            }) }) }));
}
//# sourceMappingURL=WorkItemBoard.js.map