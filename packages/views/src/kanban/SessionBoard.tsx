"use client";

import { useState, useCallback } from "react";
import { useSessionBoard, useMoveCard } from "@tide/core";
import type { KanbanColumn, KanbanCard } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import type { DropResult } from "@hello-pangea/dnd";
import { KanbanBoard } from "./KanbanBoard";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";

export function SessionBoard() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useSessionBoard();
  const moveMutation = useMoveCard();
  const queryClient = useQueryClient();

  const filterColumns = useCallback(
    (columns: KanbanColumn[]): KanbanColumn[] => {
      if (!search.trim()) return columns;
      const q = search.toLowerCase();
      return columns.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => c.title.toLowerCase().includes(q)),
      }));
    },
    [search]
  );

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result;
      if (!destination || destination.droppableId === source.droppableId) return;

      queryClient.setQueryData(
        ["kanban", "sessions", undefined],
        (old: any) => {
          if (!old?.columns) return old;
          const columns = old.columns.map((col: KanbanColumn) => ({
            ...col,
            cards: col.cards.filter((c: KanbanCard) => c.id !== draggableId),
          }));
          const srcCol = old.columns.find(
            (col: KanbanColumn) => col.id === source.droppableId
          );
          const card = srcCol?.cards.find((c: KanbanCard) => c.id === draggableId);
          if (card) {
            const destCol = columns.find(
              (col: KanbanColumn) => col.id === destination.droppableId
            );
            if (destCol) {
              destCol.cards.splice(destination.index, 0, {
                ...card,
                status: destination.droppableId,
              });
            }
          }
          return { columns };
        }
      );

      moveMutation.mutate(
        {
          card_type: "session",
          card_id: draggableId,
          target_status: destination.droppableId,
        },
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: ["kanban", "sessions"] });
          },
        }
      );
    },
    [moveMutation, queryClient]
  );

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">加载中...</div>;
  }

  const columns = filterColumns(data?.columns ?? []);
  const totalCards = columns.reduce((sum, c) => sum + c.cards.length, 0);

  return (
    <div className="space-y-4">
      <KanbanFilters search={search} onSearchChange={setSearch} />
      {totalCards === 0 ? (
        <EmptyState
          message="暂无活跃会话"
          hint="当任务被创建或运行时，会话会出现在这里"
        />
      ) : (
        <KanbanBoard columns={columns} onDragEnd={handleDragEnd} />
      )}
    </div>
  );
}
