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

const CATEGORY_COLORS: Record<string, { ring: string; dot: string; tint: string }> = {
  todo: {
    ring: "border-zinc-200",
    dot: "bg-zinc-400",
    tint: "bg-muted/30",
  },
  in_progress: {
    ring: "border-blue-200/70",
    dot: "bg-blue-500",
    tint: "bg-blue-50/40",
  },
  review: {
    ring: "border-amber-200/70",
    dot: "bg-amber-500",
    tint: "bg-amber-50/40",
  },
  done: {
    ring: "border-emerald-200/70",
    dot: "bg-emerald-500",
    tint: "bg-emerald-50/40",
  },
  custom: {
    ring: "border-violet-200/70",
    dot: "bg-violet-500",
    tint: "bg-violet-50/40",
  },
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
      <div className="py-16 text-center text-sm text-muted-foreground">
        加载看板中…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-16 text-center text-sm text-destructive">
        看板加载失败
      </div>
    );
  }

  const columns = data?.columns ?? [];

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40 py-16 text-center shadow-card">
        <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          NO WORKFLOW BOUND
        </div>
        <p className="mt-3 text-base font-medium text-foreground">
          该项目尚未绑定工作流，请先配置工作流
        </p>
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-5 overflow-x-auto pb-4">
        {columns.map((column) => {
          const isEnd = column.node_type === "end";
          const palette = isEnd
            ? {
                ring: "border-emerald-300/70",
                dot: "bg-emerald-500",
                tint: "bg-emerald-50/60",
              }
            : (CATEGORY_COLORS[column.category ?? "custom"] ??
              CATEGORY_COLORS.custom);
          return (
            <div
              key={column.id}
              className={`flex w-72 shrink-0 flex-col rounded-xl border ${palette.ring} ${palette.tint} p-3 transition-smooth`}
            >
              {/* Column header */}
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full ${palette.dot}`}
                  />
                  <span>{column.label}</span>
                  {isEnd && (
                    <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                      ✓
                    </span>
                  )}
                </h3>
                <Badge
                  variant="secondary"
                  className="rounded-full bg-background/80 px-2 text-[11px] font-medium"
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
                    className={`flex min-h-[160px] flex-1 flex-col gap-3 rounded-lg p-1 transition-smooth ${
                      snapshot.isDraggingOver
                        ? "bg-emerald-50/60 ring-1 ring-emerald-300/60"
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
