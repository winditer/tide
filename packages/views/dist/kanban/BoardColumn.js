"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "@tide/ui";
import { Droppable } from "@hello-pangea/dnd";
import { BoardCard } from "./BoardCard";
export function BoardColumn({ column }) {
    return (_jsxs("div", { className: "flex flex-1 min-w-[220px] flex-col rounded-xl border border-border/60 bg-muted/30 p-3 transition-smooth", children: [_jsxs("div", { className: "mb-3 flex items-center justify-between px-1", children: [_jsx("h3", { className: "text-sm font-semibold tracking-tight text-foreground", children: column.title }), _jsx(Badge, { variant: "secondary", className: "rounded-full bg-background/80 px-2 text-[11px] font-medium", children: column.cards.length })] }), _jsx(Droppable, { droppableId: column.id, children: (provided, snapshot) => (_jsxs("div", Object.assign({ ref: provided.innerRef }, provided.droppableProps, { className: `flex min-h-[140px] flex-1 flex-col gap-3 rounded-lg p-1 transition-smooth ${snapshot.isDraggingOver
                        ? "bg-primary/5 ring-1 ring-primary/20"
                        : ""}`, children: [column.cards.map((card, index) => (_jsx(BoardCard, { card: card, index: index }, card.id))), provided.placeholder] }))) })] }));
}
//# sourceMappingURL=BoardColumn.js.map