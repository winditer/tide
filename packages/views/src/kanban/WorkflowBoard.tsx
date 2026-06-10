"use client";

import { useState, useCallback } from "react";
import { useWorkflowBoard, useMoveCard } from "@tide/core";
import type { KanbanColumn, KanbanCard } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import type { DropResult } from "@hello-pangea/dnd";
import { KanbanBoard } from "./KanbanBoard";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";

export function WorkflowBoard() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useWorkflowBoard();
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
        ["kanban", "workflows", undefined],
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
          card_type: "task",
          card_id: draggableId,
          target_status: destination.droppableId,
        },
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: ["kanban", "workflows"] });
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
          message="暂无工作流运行"
          hint="在工作流页启动一个运行，节点状态会出现在这里"
        />
      ) : (
        <KanbanBoard columns={columns} onDragEnd={handleDragEnd} />
      )}
    </div>
  );
}
