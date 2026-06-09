"use client";

import { Badge } from "@lark2codex/ui";
import { Droppable } from "@hello-pangea/dnd";
import type { KanbanColumn } from "@lark2codex/core";
import { BoardCard } from "./BoardCard";

interface BoardColumnProps {
  column: KanbanColumn;
}

export function BoardColumn({ column }: BoardColumnProps) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/50 p-2">
      {/* Column header */}
      <div className="mb-2 flex items-center justify-between px-2 py-1">
        <h3 className="text-sm font-semibold text-foreground">{column.title}</h3>
        <Badge variant="secondary" className="text-xs">
          {column.cards.length}
        </Badge>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex min-h-[120px] flex-1 flex-col gap-2 rounded-md p-1 transition-colors ${
              snapshot.isDraggingOver ? "bg-primary/5" : ""
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
