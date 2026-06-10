"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback } from "react";
import { useWorkflowBoard, useMoveCard } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { KanbanBoard } from "./KanbanBoard";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";
export function WorkflowBoard() {
    var _a;
    const [search, setSearch] = useState("");
    const { data, isLoading } = useWorkflowBoard();
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
        queryClient.setQueryData(["kanban", "workflows", undefined], (old) => {
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
            card_type: "task",
            card_id: draggableId,
            target_status: destination.droppableId,
        }, {
            onError: () => {
                queryClient.invalidateQueries({ queryKey: ["kanban", "workflows"] });
            },
        });
    }, [moveMutation, queryClient]);
    if (isLoading) {
        return _jsx("div", { className: "py-8 text-center text-muted-foreground", children: "\u52A0\u8F7D\u4E2D..." });
    }
    const columns = filterColumns((_a = data === null || data === void 0 ? void 0 : data.columns) !== null && _a !== void 0 ? _a : []);
    const totalCards = columns.reduce((sum, c) => sum + c.cards.length, 0);
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(KanbanFilters, { search: search, onSearchChange: setSearch }), totalCards === 0 ? (_jsx(EmptyState, { message: "\u6682\u65E0\u5DE5\u4F5C\u6D41\u8FD0\u884C", hint: "\u5728\u5DE5\u4F5C\u6D41\u9875\u542F\u52A8\u4E00\u4E2A\u8FD0\u884C\uFF0C\u8282\u70B9\u72B6\u6001\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC" })) : (_jsx(KanbanBoard, { columns: columns, onDragEnd: handleDragEnd }))] }));
}
//# sourceMappingURL=WorkflowBoard.js.map