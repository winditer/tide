"use client";

import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import type { KanbanColumn } from "@lark2codex/core";
import { BoardColumn } from "./BoardColumn";

interface KanbanBoardProps {
  columns: KanbanColumn[];
  onDragEnd: (result: DropResult) => void;
}

export function KanbanBoard({ columns, onDragEnd }: KanbanBoardProps) {
  // 防御性兜底：确保即使上游传入 undefined / 非数组（例如直接把后端原始响应透传过来）也不会崩溃
  const safeColumns: KanbanColumn[] = Array.isArray(columns)
    ? columns
    : Array.isArray((columns as any)?.columns)
      ? (columns as any).columns
      : [];

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {safeColumns.map((column) => (
          <BoardColumn key={column.id} column={column} />
        ))}
      </div>
    </DragDropContext>
  );
}
