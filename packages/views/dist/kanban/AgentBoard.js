"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback, useMemo } from "react";
import { useAgentBoard, useMoveCard } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { DragDropContext } from "@hello-pangea/dnd";
import { Badge } from "@tide/ui";
import { BoardColumn } from "./BoardColumn";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";
export function AgentBoard({ groupId, projectId } = {}) {
    const [search, setSearch] = useState("");
    const queryParams = useMemo(() => ({ group_id: groupId, project_id: projectId }), [groupId, projectId]);
    const { data, isLoading } = useAgentBoard(queryParams);
    const moveMutation = useMoveCard();
    const queryClient = useQueryClient();
    const handleDragEnd = useCallback((result) => {
        var _a;
        const { draggableId, destination, source } = result;
        if (!destination || destination.droppableId === source.droppableId)
            return;
        // Optimistic update
        queryClient.setQueryData(["kanban", "agents", queryParams], (old) => {
            if (!old)
                return old;
            return old.map((swimlane) => (Object.assign(Object.assign({}, swimlane), { columns: swimlane.columns.map((col) => {
                    if (col.id === source.droppableId) {
                        return Object.assign(Object.assign({}, col), { cards: col.cards.filter((c) => c.id !== draggableId) });
                    }
                    if (col.id === destination.droppableId) {
                        const srcSwimlane = old.find((s) => s.columns.some((c) => c.id === source.droppableId));
                        const srcCol = srcSwimlane === null || srcSwimlane === void 0 ? void 0 : srcSwimlane.columns.find((c) => c.id === source.droppableId);
                        const card = srcCol === null || srcCol === void 0 ? void 0 : srcCol.cards.find((c) => c.id === draggableId);
                        if (card) {
                            const newCards = [...col.cards];
                            newCards.splice(destination.index, 0, Object.assign(Object.assign({}, card), { status: destination.droppableId }));
                            return Object.assign(Object.assign({}, col), { cards: newCards });
                        }
                    }
                    return col;
                }) })));
        });
        // Agent 看板的 column id 形如 `${agent}:${status}`，需要从中解析出真实状态
        const targetStatus = (_a = destination.droppableId.split(":").pop()) !== null && _a !== void 0 ? _a : destination.droppableId;
        moveMutation.mutate({
            card_type: "task",
            card_id: draggableId,
            target_status: targetStatus,
        }, {
            onError: () => {
                queryClient.invalidateQueries({ queryKey: ["kanban", "agents"] });
            },
        });
    }, [moveMutation, queryClient, queryParams]);
    if (isLoading) {
        return _jsx("div", { className: "py-8 text-center text-muted-foreground", children: "\u52A0\u8F7D\u4E2D..." });
    }
    const swimlanes = Array.isArray(data) ? data : [];
    const filteredSwimlanes = search.trim()
        ? swimlanes.map((s) => (Object.assign(Object.assign({}, s), { columns: s.columns.map((col) => (Object.assign(Object.assign({}, col), { cards: col.cards.filter((c) => c.title.toLowerCase().includes(search.toLowerCase())) }))) })))
        : swimlanes;
    const totalCards = filteredSwimlanes.reduce((sum, s) => sum + s.columns.reduce((c, col) => c + col.cards.length, 0), 0);
    const hasContent = filteredSwimlanes.length > 0 && totalCards > 0;
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(KanbanFilters, { search: search, onSearchChange: setSearch }), !hasContent ? (_jsx(EmptyState, { message: "\u6682\u65E0\u8FD0\u884C\u4E2D\u7684\u4EFB\u52A1", hint: "\u5F53 Agent \u63A5\u6536\u5230\u4EFB\u52A1\u540E\uFF0C\u4F1A\u6309\u6CF3\u9053\u663E\u793A\u5728\u8FD9\u91CC" })) : (_jsx(DragDropContext, { onDragEnd: handleDragEnd, children: _jsx("div", { className: "space-y-5", children: filteredSwimlanes.map((swimlane) => (_jsxs("div", { className: `rounded-xl border border-border/60 bg-card/60 p-4 shadow-card transition-smooth ${swimlane.idle ? "border-dashed opacity-60" : "hover:shadow-card-hover"}`, children: [_jsxs("div", { className: "mb-3 flex items-center gap-2 border-b border-border/40 pb-3", children: [_jsx("span", { className: "flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold uppercase text-primary", children: swimlane.agent.slice(0, 2) }), _jsx("span", { className: "text-sm font-semibold tracking-tight", children: swimlane.agent }), swimlane.idle && (_jsx(Badge, { variant: "outline", className: "text-xs", children: "\u7A7A\u95F2" }))] }), _jsx("div", { className: "flex gap-5 overflow-x-auto pb-2", children: swimlane.columns.map((column) => (_jsx(BoardColumn, { column: column }, column.id))) })] }, swimlane.agent))) }) }))] }));
}
//# sourceMappingURL=AgentBoard.js.map