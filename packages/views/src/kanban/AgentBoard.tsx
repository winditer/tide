"use client";

import { useState, useCallback, useMemo } from "react";
import { useAgentBoard, useMoveCard } from "@tide/core";
import type { KanbanColumn, KanbanCard, AgentSwimlane } from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { Badge } from "@tide/ui";
import { BoardColumn } from "./BoardColumn";
import { KanbanFilters } from "./KanbanFilters";
import { EmptyState } from "./EmptyState";

export interface AgentBoardProps {
  groupId?: string;
  projectId?: string;
}

export function AgentBoard({ groupId, projectId }: AgentBoardProps = {}) {
  const [search, setSearch] = useState("");
  const queryParams = useMemo(
    () => ({ group_id: groupId, project_id: projectId }),
    [groupId, projectId],
  );
  const { data, isLoading } = useAgentBoard(queryParams);
  const moveMutation = useMoveCard();
  const queryClient = useQueryClient();

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result;
      if (!destination || destination.droppableId === source.droppableId) return;

      // Optimistic update
      queryClient.setQueryData(
        ["kanban", "agents", queryParams],
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
    [moveMutation, queryClient, queryParams]
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
        <div className="space-y-5">
          {filteredSwimlanes.map((swimlane) => (
            <div
              key={swimlane.agent}
              className={`rounded-xl border border-border/60 bg-card/60 p-4 shadow-card transition-smooth ${
                swimlane.idle ? "border-dashed opacity-60" : "hover:shadow-card-hover"
              }`}
            >
              {/* Swimlane header */}
              <div className="mb-3 flex items-center gap-2 border-b border-border/40 pb-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold uppercase text-primary">
                  {swimlane.agent.slice(0, 2)}
                </span>
                <span className="text-sm font-semibold tracking-tight">{swimlane.agent}</span>
                {swimlane.idle && (
                  <Badge variant="outline" className="text-xs">
                    空闲
                  </Badge>
                )}
              </div>
              {/* Columns */}
              <div className="flex gap-5 overflow-x-auto pb-2">
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
