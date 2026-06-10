"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback } from "react";
import { useProjectBoard, useMoveCard } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { KanbanBoard } from "./KanbanBoard";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";
export function ProjectBoard() {
    var _a;
    const [search, setSearch] = useState("");
    const { data, isLoading } = useProjectBoard();
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
        queryClient.setQueryData(["kanban", "projects", undefined], (old) => {
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
    }, [moveMutation, queryClient]);
    if (isLoading) {
        return _jsx("div", { className: "py-8 text-center text-muted-foreground", children: "\u52A0\u8F7D\u4E2D..." });
    }
    const columns = filterColumns((_a = data === null || data === void 0 ? void 0 : data.columns) !== null && _a !== void 0 ? _a : []);
    const totalCards = columns.reduce((sum, c) => sum + c.cards.length, 0);
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(KanbanFilters, { search: search, onSearchChange: setSearch }), totalCards === 0 ? (_jsx(EmptyState, { message: "\u6682\u65E0\u9879\u76EE", hint: "\u8BF7\u901A\u8FC7 Lark \u53D1\u9001\u4EFB\u52A1\uFF0C\u6216\u5728\u9879\u76EE\u9875\u6DFB\u52A0\u65B0\u7684\u9879\u76EE" })) : (_jsx(KanbanBoard, { columns: columns, onDragEnd: handleDragEnd }))] }));
}
//# sourceMappingURL=ProjectBoard.js.map