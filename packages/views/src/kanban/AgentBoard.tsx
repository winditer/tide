"use client";

import { useState, useCallback } from "react";
import { useAgentBoard, useMoveCard } from "@lark2codex/core";
import type { KanbanColumn, KanbanCard, AgentSwimlane } from "@lark2codex/core";
import { useQueryClient } from "@tanstack/react-query";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { Badge } from "@lark2codex/ui";
import { BoardColumn } from "./BoardColumn";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";

export function AgentBoard() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useAgentBoard();
  const moveMutation = useMoveCard();
  const queryClient = useQueryClient();

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result;
      if (!destination || destination.droppableId === source.droppableId) return;

      // Optimistic update
      queryClient.setQueryData(
        ["kanban", "agents", undefined],
        (old: AgentSwimlane[] | undefined) => {
          if (!old) return old;
          return old.map((swimlane) => ({
            ...swimlane,
            columns: swimlane.columns.map((col) => {
              if (col.id === source.droppableId) {
                return {
                  ...col,
                  cards: col.cards.filter((c) => c.id !== draggableId),
                };
              }
              if (col.id === destination.droppableId) {
                const srcSwimlane = old.find((s) =>
                  s.columns.some((c) => c.id === source.droppableId)
                );
                const srcCol = srcSwimlane?.columns.find(
                  (c) => c.id === source.droppableId
                );
                const card = srcCol?.cards.find((c) => c.id === draggableId);
                if (card) {
                  const newCards = [...col.cards];
                  newCards.splice(destination.index, 0, {
                    ...card,
                    status: destination.droppableId,
                  });
                  return { ...col, cards: newCards };
                }
              }
              return col;
            }),
          }));
        }
      );

      // Agent 看板的 column id 形如 `${agent}:${status}`，需要从中解析出真实状态
      const targetStatus =
        destination.droppableId.split(":").pop() ?? destination.droppableId;

      moveMutation.mutate(
        {
          card_type: "task",
          card_id: draggableId,
          target_status: targetStatus,
        },
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: ["kanban", "agents"] });
          },
        }
      );
    },
    [moveMutation, queryClient]
  );

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">加载中...</div>;
  }

  const swimlanes = Array.isArray(data) ? data : [];

  const filteredSwimlanes = search.trim()
    ? swimlanes.map((s) => ({
        ...s,
        columns: s.columns.map((col) => ({
          ...col,
          cards: col.cards.filter((c) =>
            c.title.toLowerCase().includes(search.toLowerCase())
          ),
        })),
      }))
    : swimlanes;

  const totalCards = filteredSwimlanes.reduce(
    (sum, s) => sum + s.columns.reduce((c, col) => c + col.cards.length, 0),
    0
  );
  const hasContent = filteredSwimlanes.length > 0 && totalCards > 0;

  return (
    <div className="space-y-4">
      <KanbanFilters search={search} onSearchChange={setSearch} />
      {!hasContent ? (
        <EmptyState
          message="暂无运行中的任务"
          hint="当 Agent 接收到任务后，会按泳道显示在这里"
        />
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
        <div className="space-y-6">
          {filteredSwimlanes.map((swimlane) => (
            <div
              key={swimlane.agent}
              className={`rounded-lg border p-4 ${
                swimlane.idle ? "border-dashed opacity-60" : ""
              }`}
            >
              {/* Swimlane header */}
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm font-semibold">{swimlane.agent}</span>
                {swimlane.idle && (
                  <Badge variant="outline" className="text-xs">
                    空闲
                  </Badge>
                )}
              </div>
              {/* Columns */}
              <div className="flex gap-4 overflow-x-auto pb-2">
                {swimlane.columns.map((column) => (
                  <BoardColumn key={column.id} column={column} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </DragDropContext>
      )}
    </div>
  );
}
