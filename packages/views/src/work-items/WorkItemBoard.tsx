"use client";

import { useCallback } from "react";
import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Badge } from "@tide/ui";
import {
  useWorkItemBoard,
  useMoveWorkItem,
  type WorkItem,
  type WorkItemBoardColumn,
} from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { WorkItemCard } from "./WorkItemCard";

interface WorkItemBoardProps {
  projectId: string;
  onCardClick?: (item: WorkItem) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  todo: "border-zinc-400 bg-zinc-50",
  in_progress: "border-blue-400 bg-blue-50/30",
  review: "border-amber-400 bg-amber-50/30",
  done: "border-emerald-400 bg-emerald-50/30",
  custom: "border-violet-400 bg-violet-50/30",
};

export function WorkItemBoard({ projectId, onCardClick }: WorkItemBoardProps) {
  const { data, isLoading, isError } = useWorkItemBoard(projectId);
  const moveMutation = useMoveWorkItem();
  const queryClient = useQueryClient();

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result;
      if (!destination || destination.droppableId === source.droppableId) return;

      const targetNodeId = destination.droppableId;

      // 不允许拖拽到 end 列（已完成状态不应该手动进入）
      const destColumn = data?.columns.find((c) => c.id === targetNodeId);
      if (destColumn?.node_type === "end") return;

      // Optimistic update
      queryClient.setQueryData(
        ["work-items", "board", projectId],
        (old: any) => {
          if (!old?.columns) return old;
          let movedItem: WorkItem | undefined;
          const columns = old.columns.map((col: WorkItemBoardColumn) => {
            const filtered = col.items.filter((item: WorkItem) => {
              if (item.id === draggableId) {
                movedItem = item;
                return false;
              }
              return true;
            });
            return { ...col, items: filtered };
          });
          if (movedItem) {
            const destCol = columns.find(
              (col: WorkItemBoardColumn) => col.id === targetNodeId
            );
            if (destCol) {
              destCol.items.splice(destination.index, 0, {
                ...movedItem,
                current_node_id: targetNodeId,
              });
            }
          }
          return { ...old, columns };
        }
      );

      moveMutation.mutate(
        { id: draggableId, targetNodeId },
        {
          onError: () => {
            queryClient.invalidateQueries({
              queryKey: ["work-items", "board", projectId],
            });
          },
        }
      );
    },
    [moveMutation, queryClient, projectId, data]
  );

  if (isLoading) {
    return (
      <div className="py-16 text-center font-mono text-xs tracking-widest text-zinc-500">
        ◐ LOADING BOARD…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-16 text-center font-mono text-xs text-rose-600">
        ✕ FAILED TO LOAD BOARD
      </div>
    );
  }

  const columns = data?.columns ?? [];

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-300 py-16 text-center">
        <div className="font-mono text-[11px] tracking-[0.3em] text-zinc-400">
          NO WORKFLOW BOUND
        </div>
        <p className="mt-3 font-serif text-lg text-zinc-600">
          该项目尚未绑定工作流，请先配置工作流
        </p>
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => {
          const isEnd = column.node_type === "end";
          const colorClass = isEnd
            ? "border-emerald-500 bg-emerald-50/60"
            : (CATEGORY_COLORS[column.category ?? "custom"] ??
              CATEGORY_COLORS.custom);
          return (
            <div
              key={column.id}
              className={`flex w-72 shrink-0 flex-col rounded-lg border-2 p-2 ${colorClass}`}
            >
              {/* Column header */}
              <div className="mb-2 flex items-center justify-between px-2 py-1">
                <h3
                  className={`flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wider ${
                    isEnd ? "text-emerald-700" : "text-zinc-800"
                  }`}
                >
                  {isEnd && (
                    <span
                      aria-label="completed"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-500 font-mono text-[10px] font-black text-white"
                    >
                      ✓
                    </span>
                  )}
                  <span>{column.label}</span>
                </h3>
                <Badge
                  variant="secondary"
                  className={`border font-mono text-[10px] ${
                    isEnd
                      ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                      : "border-zinc-300 bg-white text-zinc-700"
                  }`}
                >
                  {column.items.length}
                </Badge>
              </div>

              {/* Droppable area */}
              <Droppable droppableId={column.id} isDropDisabled={isEnd}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex min-h-[140px] flex-1 flex-col gap-2 rounded-md p-1 transition-colors ${
                      snapshot.isDraggingOver
                        ? "bg-emerald-50 ring-2 ring-emerald-300/50"
                        : ""
                    }`}
                  >
                    {column.items.map((item, index) => (
                      <WorkItemCard
                        key={item.id}
                        item={item}
                        index={index}
                        onClick={onCardClick}
                        completed={isEnd}
                      />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
