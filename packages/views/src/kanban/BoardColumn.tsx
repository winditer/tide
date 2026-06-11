"use client";

import { Badge } from "@tide/ui";
import { Droppable } from "@hello-pangea/dnd";
import type { KanbanColumn } from "@tide/core";
import { BoardCard } from "./BoardCard";

interface BoardColumnProps {
  column: KanbanColumn;
}

export function BoardColumn({ column }: BoardColumnProps) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl border border-border/60 bg-muted/30 p-3 transition-smooth">
      {/* Column header */}
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          {column.title}
        </h3>
        <Badge
          variant="secondary"
          className="rounded-full bg-background/80 px-2 text-[11px] font-medium"
        >
          {column.cards.length}
        </Badge>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex min-h-[140px] flex-1 flex-col gap-3 rounded-lg p-1 transition-smooth ${
              snapshot.isDraggingOver
                ? "bg-primary/5 ring-1 ring-primary/20"
                : ""
            }`}
          >
            {column.cards.map((card, index) => (
              <BoardCard key={card.id} card={card} index={index} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
