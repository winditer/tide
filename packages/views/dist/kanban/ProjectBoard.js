"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback, useMemo } from "react";
import { useProjectBoard, useMoveCard } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { DragDropContext, Droppable } from "@hello-pangea/dnd";
import { Badge } from "@tide/ui";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";
import { ProjectCard } from "./ProjectCard";
export function ProjectBoard({ groupId, projectId } = {}) {
    var _a;
    const [search, setSearch] = useState("");
    const queryParams = useMemo(() => ({ group_id: groupId, project_id: projectId }), [groupId, projectId]);
    const { data, isLoading } = useProjectBoard(queryParams);
    const moveMutation = useMoveCard();
    const queryClient = useQueryClient();
    const filterColumns = useCallback((columns) => {
        if (!search.trim())
            return columns;
        const q = search.toLowerCase();
        return columns.map((col) => (Object.assign(Object.assign({}, col), { cards: col.cards.filter((c) => c.title.toLowerCase().includes(q)) })));
    }, [search]);
    const handleDragEnd = useCallback((result) => {
        const { draggableId, destination, source } = result;
        if (!destination || destination.droppableId === source.droppableId)
            return;
        // Optimistic update
        queryClient.setQueryData(["kanban", "projects", queryParams], (old) => {
            if (!(old === null || old === void 0 ? void 0 : old.columns))
                return old;
            const columns = old.columns.map((col) => (Object.assign(Object.assign({}, col), { cards: col.cards.filter((c) => c.id !== draggableId) })));
            const srcCol = old.columns.find((col) => col.id === source.droppableId);
            const card = srcCol === null || srcCol === void 0 ? void 0 : srcCol.cards.find((c) => c.id === draggableId);
            if (card) {
                const destCol = columns.find((col) => col.id === destination.droppableId);
                if (destCol) {
                    destCol.cards.splice(destination.index, 0, Object.assign(Object.assign({}, card), { status: destination.droppableId }));
                }
            }
            return { columns };
        });
        moveMutation.mutate({
            card_type: "project",
            card_id: draggableId,
            target_status: destination.droppableId,
        }, {
            onError: () => {
                queryClient.invalidateQueries({ queryKey: ["kanban", "projects"] });
            },
        });
    }, [moveMutation, queryClient, queryParams]);
    if (isLoading) {
        return _jsx("div", { className: "py-8 text-center text-muted-foreground", children: "\u52A0\u8F7D\u4E2D..." });
    }
    const columns = filterColumns((_a = data === null || data === void 0 ? void 0 : data.columns) !== null && _a !== void 0 ? _a : []);
    const totalCards = columns.reduce((sum, c) => sum + c.cards.length, 0);
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(KanbanFilters, { search: search, onSearchChange: setSearch }), totalCards === 0 ? (_jsx(EmptyState, { message: "\u6682\u65E0\u9879\u76EE", hint: "\u8BF7\u901A\u8FC7 Lark \u53D1\u9001\u4EFB\u52A1\uFF0C\u6216\u5728\u9879\u76EE\u9875\u6DFB\u52A0\u65B0\u7684\u9879\u76EE" })) : (_jsx(DragDropContext, { onDragEnd: handleDragEnd, children: _jsx("div", { className: "flex gap-4 overflow-x-auto pb-2", children: columns.map((column) => (_jsxs("div", { className: "flex flex-1 min-w-[220px] flex-col rounded-xl border border-border/60 bg-muted/30 p-3 transition-smooth", children: [_jsxs("div", { className: "mb-3 flex items-center justify-between px-1", children: [_jsx("h3", { className: "text-sm font-semibold tracking-tight text-foreground", children: column.title }), _jsx(Badge, { variant: "secondary", className: "rounded-full bg-background/80 px-2 text-[11px] font-medium", children: column.cards.length })] }), _jsx(Droppable, { droppableId: column.id, children: (provided, snapshot) => (_jsxs("div", Object.assign({ ref: provided.innerRef }, provided.droppableProps, { className: `flex min-h-[140px] flex-1 flex-col gap-3 rounded-lg p-1 transition-smooth ${snapshot.isDraggingOver
                                        ? "bg-primary/5 ring-1 ring-primary/20"
                                        : ""}`, children: [column.cards.map((card, idx) => (_jsx(ProjectCard, { card: card, index: idx }, card.id))), provided.placeholder] }))) })] }, column.id))) }) }))] }));
}
//# sourceMappingURL=ProjectBoard.js.map