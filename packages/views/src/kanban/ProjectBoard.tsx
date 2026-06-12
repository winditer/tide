"use client";

import { useState, useCallback } from "react";
import { useProjectBoard, useMoveCard } from "@tide/core";
import type { KanbanColumn, KanbanCard } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import type { DropResult } from "@hello-pangea/dnd";
import { DragDropContext, Droppable } from "@hello-pangea/dnd";
import { Badge } from "@tide/ui";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";
import { ProjectCard } from "./ProjectCard";

export function ProjectBoard() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useProjectBoard();
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

      // Optimistic update
      queryClient.setQueryData(
        ["kanban", "projects", undefined],
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
          card_type: "project",
          card_id: draggableId,
          target_status: destination.droppableId,
        },
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: ["kanban", "projects"] });
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
          message="暂无项目"
          hint="请通过 Lark 发送任务，或在项目页添加新的项目"
        />
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {columns.map((column) => (
              <div
                key={column.id}
                className="flex w-72 shrink-0 flex-col rounded-xl border border-border/60 bg-muted/30 p-3 transition-smooth"
              >
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
                      {column.cards.map((card, idx) => (
                        <ProjectCard key={card.id} card={card} index={idx} />
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}
