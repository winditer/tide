"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Badge } from "@tide/ui";
import {
  useWorkItemBoard,
  useMoveWorkItem,
  useUpdateWorkItemStatus,
  useWorkItems,
  useFreeformStatusList,
  useWs,
  type WorkItem,
  type WorkItemBoardColumn,
  type WorkItemFilters,
  type WorkItemFlowMode,
  type FreeformStatusItem,
} from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { WorkItemCard } from "./WorkItemCard";

export type WorkItemGroupBy = "none" | "assignee" | "priority" | "version";

interface WorkItemBoardProps {
  projectId: string;
  versionId?: string;
  /** 筛选条件（与列表视图共享同一套筛选参数） */
  filters?: WorkItemFilters;
  onCardClick?: (item: WorkItem) => void;
  /** 版本 id -> 版本名称 映射，用于卡片版本徽标与按版本分组 */
  versionMap?: Record<string, string>;
  /** 泳道分组方式，默认 none */
  groupBy?: WorkItemGroupBy;
  /** 自动刷新间隔（毫秒），0 表示关闭自动刷新，未传则使用 hook 默认值 */
  refetchInterval?: number;
  /** 项目流转模式：为 freeform 时按状态列展示；未传时会根据工作项自动推断 */
  flowMode?: WorkItemFlowMode;
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

const PRIORITY_LANE_LABELS: Record<string, string> = {
  "0": "未指定优先级",
  "1": "低优先级",
  "2": "中优先级",
  "3": "高优先级",
  "4": "紧急",
};

const PRIORITY_LANE_ORDER = ["4", "3", "2", "1", "0"];

function getColumnPalette(column: WorkItemBoardColumn) {
  const terminalPalettes: Record<string, { ring: string; dot: string; tint: string }> = {
    end: { ring: "border-emerald-300/70", dot: "bg-emerald-500", tint: "bg-emerald-50/60" },
    cancel: { ring: "border-orange-300/70", dot: "bg-orange-500", tint: "bg-orange-50/60" },
    error: { ring: "border-red-300/70", dot: "bg-red-500", tint: "bg-red-50/60" },
    close: { ring: "border-slate-300/70", dot: "bg-slate-500", tint: "bg-slate-50/60" },
  };

  if (column.node_type && column.node_type in terminalPalettes) {
    return terminalPalettes[column.node_type];
  }
  return (
    CATEGORY_COLORS[column.category ?? "custom"] ?? CATEGORY_COLORS.custom
  );
}

export function WorkItemBoard({
  projectId,
  versionId,
  filters,
  onCardClick,
  versionMap,
  groupBy = "none",
  refetchInterval,
  flowMode,
}: WorkItemBoardProps) {
  const { data, isLoading, isError } = useWorkItemBoard(
    projectId,
    versionId,
    refetchInterval,
    filters,
  );
  const moveMutation = useMoveWorkItem();
  const queryClient = useQueryClient();
  // freeform 模式下看板接口不返回列，改用工作项列表数据构建状态列
  const freeformItemsQuery = useWorkItems(projectId, filters);
  // freeform 状态列自定义配置（无配置时后端返回默认 4 列）
  const freeformStatusQuery = useFreeformStatusList(projectId);

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result;
      if (!destination || destination.droppableId === source.droppableId) return;

      const targetNodeId = destination.droppableId;
      const sourceNodeId = source.droppableId;

      // 防护：不允许从终态列拖出（已完成/已取消/失败/已关闭状态不应该被手动重置）
      const TERMINAL_TYPES = ["end", "cancel", "error", "close"];
      const sourceColumn = data?.columns.find((c) => c.id === sourceNodeId);
      if (sourceColumn?.node_type && TERMINAL_TYPES.includes(sourceColumn.node_type)) return;

      // 防护：不允许拖拽到终态列（终态状态不应该手动进入）
      const destColumn = data?.columns.find((c) => c.id === targetNodeId);
      if (destColumn?.node_type && TERMINAL_TYPES.includes(destColumn.node_type)) return;

      // Optimistic update
      queryClient.setQueryData(
        ["work-items", "board", projectId, versionId ?? null, filters ?? null],
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
          onSettled: () => {
            // 无论成败都刷新看板，确保 status / current_node_id 与后端一致
            queryClient.invalidateQueries({
              queryKey: ["work-items", "board", projectId, versionId ?? null, filters ?? null],
            });
          },
        }
      );
    },
    [moveMutation, queryClient, projectId, versionId, filters, data]
  );

  const columns = data?.columns ?? [];

  // 扁平化所有工作项（用于泳道分组）
  const allItems = useMemo<WorkItem[]>(() => {
    const arr: WorkItem[] = [];
    columns.forEach((col) => col.items.forEach((it) => arr.push(it)));
    return arr;
  }, [columns]);

  // 计算泳道
  const swimlanes = useMemo(() => {
    if (groupBy === "none") return null;

    const groups = new Map<string, WorkItem[]>();
    allItems.forEach((item) => {
      let key: string;
      if (groupBy === "assignee") {
        key = item.assignee?.trim() || "未分配";
      } else if (groupBy === "priority") {
        key = String(item.priority ?? 0);
      } else {
        // version
        key = item.version_id || "__no_version__";
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });

    let entries = Array.from(groups.entries());

    if (groupBy === "priority") {
      entries.sort(
        (a, b) =>
          PRIORITY_LANE_ORDER.indexOf(a[0]) -
          PRIORITY_LANE_ORDER.indexOf(b[0]),
      );
    } else {
      entries.sort((a, b) => {
        // 把"未分配/无版本"放最后
        const aIsFallback = a[0] === "未分配" || a[0] === "__no_version__";
        const bIsFallback = b[0] === "未分配" || b[0] === "__no_version__";
        if (aIsFallback && !bIsFallback) return 1;
        if (!aIsFallback && bIsFallback) return -1;
        return a[0].localeCompare(b[0]);
      });
    }

    return entries.map(([key, items]) => {
      let label: string;
      if (groupBy === "priority") {
        label = PRIORITY_LANE_LABELS[key] ?? key;
      } else if (groupBy === "version") {
        label =
          key === "__no_version__"
            ? "无版本"
            : versionMap?.[key] || key;
      } else {
        label = key;
      }
      return { key, label, items };
    });
  }, [groupBy, allItems, versionMap]);

  // freeform 模式判定：优先看板接口返回的 flow_mode（权威来源），
  // 其次显式传入的 flowMode prop，最后回退到按工作项 flow_mode 推断。
  const freeformItems = freeformItemsQuery.data ?? [];
  const isFreeform =
    flowMode === "freeform" ||
    data?.flow_mode === "freeform" ||
    (freeformItems.length > 0 &&
      freeformItems.every((it) => it.flow_mode === "freeform"));

  if (isFreeform) {
    return (
      <FreeformStatusBoard
        items={freeformItems}
        isLoading={freeformItemsQuery.isLoading}
        onCardClick={onCardClick}
        versionMap={versionMap}
        statusList={freeformStatusQuery.data}
      />
    );
  }

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

  // ============================================================
  // 泳道模式：按 groupBy 分组横向展示，每个泳道内仍按列布局
  // 为简化交互，泳道模式下禁用拖拽（仅展示）
  // ============================================================
  if (swimlanes) {
    return (
      <div className="space-y-6">
        {swimlanes.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            当前条件下没有可分组的工作项
          </div>
        )}
        {swimlanes.map((lane) => (
          <section
            key={lane.key}
            className="rounded-xl border border-border/60 bg-card/40 p-3"
          >
            {/* 泳道标题 */}
            <header className="mb-3 flex items-center justify-between px-1">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-primary/70" />
                {lane.label}
                <span className="text-xs font-normal text-muted-foreground">
                  ({lane.items.length})
                </span>
              </h4>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                只读模式
              </span>
            </header>

            {/* 列布局 */}
            <div className="flex gap-4 overflow-x-auto pb-2">
              {columns.map((column) => {
                const isEnd = column.node_type === "end";
                const palette = getColumnPalette(column);
                const colItems = lane.items.filter(
                  (it) => it.current_node_id === column.id,
                );
                return (
                  <div
                    key={`${lane.key}-${column.id}`}
                    className={`flex flex-1 min-w-[220px] flex-col rounded-xl border ${palette.ring} ${palette.tint} p-3`}
                  >
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h3 className="flex items-center gap-2 text-xs font-semibold tracking-tight text-foreground">
                        <span
                          aria-hidden
                          className={`inline-block h-1.5 w-1.5 rounded-full ${palette.dot}`}
                        />
                        <span>{column.label}</span>
                      </h3>
                      <Badge
                        variant="secondary"
                        className="rounded-full bg-background/80 px-2 text-[10px] font-medium"
                      >
                        {colItems.length}
                      </Badge>
                    </div>

                    <div className="flex flex-1 flex-col gap-2 rounded-lg p-1">
                      {colItems.map((item, index) => (
                        <WorkItemCard
                          key={item.id}
                          item={item}
                          index={index}
                          onClick={onCardClick}
                          completed={isEnd}
                          versionMap={versionMap}
                          draggable={false}
                        />
                      ))}
                      {colItems.length === 0 && (
                        <div className="py-3 text-center text-[10px] text-muted-foreground/60">
                          —
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  // ============================================================
  // 默认看板模式：支持拖拽流转
  // ============================================================
  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-5 overflow-x-auto pb-4">
        {columns.map((column) => {
          const isEnd = column.node_type === "end";
          const palette = getColumnPalette(column);
          return (
            <div
              key={column.id}
              className={`flex flex-1 min-w-[220px] flex-col rounded-xl border ${palette.ring} ${palette.tint} p-3 transition-smooth`}
            >
              {/* Column header */}
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full ${palette.dot}`}
                  />
                  <span>{column.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    ({column.items.length})
                  </span>
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
                        versionMap={versionMap}
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

// ============================================================
// Freeform 状态看板：按 未分配 | 待接受 | 进行中 | 已完成 分列
// 数据来自工作项列表（而非工作流看板），支持拖拽改变状态
// ============================================================

interface FreeformStatusBoardProps {
  items: WorkItem[];
  isLoading?: boolean;
  onCardClick?: (item: WorkItem) => void;
  versionMap?: Record<string, string>;
  /** 项目自定义状态列；未传或为空时回退到默认 4 列 */
  statusList?: FreeformStatusItem[];
}

// 默认 4 列（无自定义配置时使用）
const DEFAULT_FREEFORM_COLUMNS: { key: string; label: string }[] = [
  { key: "unassigned", label: "未分配" },
  { key: "pending", label: "待接受" },
  { key: "in_progress", label: "进行中" },
  { key: "completed", label: "已完成" },
];

// 状态 key 到调色板的映射，未知 key 使用 custom
const FREEFORM_PALETTE: Record<
  string,
  { ring: string; dot: string; tint: string }
> = {
  unassigned: CATEGORY_COLORS.todo,
  pending: CATEGORY_COLORS.review,
  in_progress: CATEGORY_COLORS.in_progress,
  completed: CATEGORY_COLORS.done,
};

/** 根据工作项状态与负责人将其归入唯一状态列 */
function classifyFreeformItem(item: WorkItem, columnKeys: string[]): string {
  // 状态值直接匹配某个状态列时优先使用（支持拖拽手动设置的状态）
  if (item.status && columnKeys.includes(item.status)) return item.status;
  if (item.status === "completed") return "completed";
  if (item.status === "in_progress") return "in_progress";
  if (item.assignee && item.assignee.trim()) return "pending";
  return "unassigned";
}

function FreeformStatusBoard({
  items,
  isLoading,
  onCardClick,
  versionMap,
  statusList,
}: FreeformStatusBoardProps) {
  const { subscribe } = useWs();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const updateStatus = useUpdateWorkItemStatus();

  // 拖拽结束：将工作项状态更新为目标列 key
  const handleFreeformDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result;
      if (!destination || destination.droppableId === source.droppableId) return;
      updateStatus.mutate({
        itemId: draggableId,
        status: destination.droppableId,
      });
    },
    [updateStatus],
  );

  // 订阅 work_item.blocked / work_item.unblocked，维护阻塞工作项集合
  useEffect(() => {
    const unsub = subscribe((event: unknown) => {
      const ev = event as { type?: string; work_item_id?: string };
      if (!ev?.work_item_id) return;
      if (ev.type === "work_item.blocked") {
        setBlockedIds((prev) => {
          const next = new Set(prev);
          next.add(ev.work_item_id as string);
          return next;
        });
      } else if (ev.type === "work_item.unblocked") {
        setBlockedIds((prev) => {
          if (!prev.has(ev.work_item_id as string)) return prev;
          const next = new Set(prev);
          next.delete(ev.work_item_id as string);
          return next;
        });
      }
    });
    return () => unsub();
  }, [subscribe]);

  const columns = useMemo(() => {
    const list =
      statusList && statusList.length > 0
        ? statusList
        : DEFAULT_FREEFORM_COLUMNS;
    return list.map((c) => ({
      key: c.key,
      label: c.label,
      palette: FREEFORM_PALETTE[c.key] ?? CATEGORY_COLORS.custom,
    }));
  }, [statusList]);

  const grouped = useMemo(() => {
    const columnKeys = columns.map((c) => c.key);
    const map: Record<string, WorkItem[]> = {};
    for (const col of columns) map[col.key] = [];
    for (const it of items) {
      const key = classifyFreeformItem(it, columnKeys);
      // 若归类 key 不在自定义列中，归入第一列作为兑底
      if (map[key]) {
        map[key].push(it);
      } else if (columns.length > 0) {
        map[columns[0].key].push(it);
      }
    }
    return map;
  }, [items, columns]);

  if (isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        加载看板中…
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleFreeformDragEnd}>
      <div className="flex gap-5 overflow-x-auto pb-4">
        {columns.map((column) => {
          const colItems = grouped[column.key] ?? [];
          const isDone = column.key === "completed";
          return (
            <div
              key={column.key}
              className={`flex flex-1 min-w-[220px] flex-col rounded-xl border ${column.palette.ring} ${column.palette.tint} p-3 transition-smooth`}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full ${column.palette.dot}`}
                  />
                  <span>{column.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    ({colItems.length})
                  </span>
                </h3>
                <Badge
                  variant="secondary"
                  className="rounded-full bg-background/80 px-2 text-[11px] font-medium"
                >
                  {colItems.length}
                </Badge>
              </div>

              <Droppable droppableId={column.key}>
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
                    {colItems.map((item, index) => (
                      <WorkItemCard
                        key={item.id}
                        item={item}
                        index={index}
                        onClick={onCardClick}
                        completed={isDone}
                        versionMap={versionMap}
                        draggable={true}
                        blocked={blockedIds.has(item.id)}
                      />
                    ))}
                    {colItems.length === 0 && (
                      <div className="py-3 text-center text-[10px] text-muted-foreground/60">
                        —
                      </div>
                    )}
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
