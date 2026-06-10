"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "@tide/ui";
import { Droppable } from "@hello-pangea/dnd";
import { BoardCard } from "./BoardCard";
export function BoardColumn({ column }) {
    return (_jsxs("div", { className: "flex w-72 shrink-0 flex-col rounded-lg bg-muted/50 p-2", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between px-2 py-1", children: [_jsx("h3", { className: "text-sm font-semibold text-foreground", children: column.title }), _jsx(Badge, { variant: "secondary", className: "text-xs", children: column.cards.length })] }), _jsx(Droppable, { droppableId: column.id, children: (provided, snapshot) => (_jsxs("div", Object.assign({ ref: provided.innerRef }, provided.droppableProps, { className: `flex min-h-[120px] flex-1 flex-col gap-2 rounded-md p-1 transition-colors ${snapshot.isDraggingOver ? "bg-primary/5" : ""}`, children: [column.cards.map((card, index) => (_jsx(BoardCard, { card: card, index: index }, card.id))), provided.placeholder] }))) })] }));
}
//# sourceMappingURL=BoardColumn.js.map