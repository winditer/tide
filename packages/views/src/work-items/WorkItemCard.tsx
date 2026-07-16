"use client";

import { useMemo } from "react";
import { Badge, cn } from "@tide/ui";
import { Draggable } from "@hello-pangea/dnd";
import type { WorkItem, WorkItemStatus } from "@tide/core";

const STATUS_CONFIG: Record<WorkItemStatus, { label: string; color: string }> = {
  pending: { label: "待操作", color: "bg-gray-100 text-gray-700 border border-gray-200" },
  in_progress: { label: "进行中", color: "bg-blue-100 text-blue-700 border border-blue-200" },
  pending_approval: { label: "待审批", color: "bg-amber-100 text-amber-700 border border-amber-200" },
  completed: { label: "已完成", color: "bg-green-100 text-green-700 border border-green-200" },
  failed: { label: "失败", color: "bg-red-100 text-red-700 border border-red-200" },
  waiting: { label: "等待中", color: "bg-purple-100 text-purple-700 border border-purple-200" },
  cancelled: { label: "已取消", color: "bg-orange-100 text-orange-700 border border-orange-200" },
  closed: { label: "已关闭", color: "bg-slate-100 text-slate-700 border border-slate-200" },
};

const PRIORITY_CONFIG: Record<number, { label: string; color: string }> = {
  0: { label: "无", color: "bg-muted text-muted-foreground" },
  1: { label: "低", color: "bg-blue-50 text-blue-700 border border-blue-200" },
  2: { label: "中", color: "bg-amber-50 text-amber-700 border border-amber-200" },
  3: { label: "高", color: "bg-orange-50 text-orange-700 border border-orange-200" },
  4: { label: "紧急", color: "bg-rose-50 text-rose-700 border border-rose-200" },
};

/** 卡片左侧色条：根据优先级映射到边框颜色 */
const PRIORITY_BORDER: Record<number, string> = {
  0: "border-l-transparent",
  1: "border-l-gray-300",
  2: "border-l-blue-400",
  3: "border-l-orange-400",
  4: "border-l-red-500",
};

/** 滞留预警阈值（天） */
const STALE_DAYS_THRESHOLD = 3;

function formatTime(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface WorkItemCardProps {
  item: WorkItem;
  index: number;
  onClick?: (item: WorkItem) => void;
  /** 在 end 节点列下的卡片：只读、不可拖动、带完成视觉样式 */
  completed?: boolean;
  /** 版本 id -> 版本名称 映射，用于渲染版本标签 */
  versionMap?: Record<string, string>;
  /** 是否禁用拖拽（如泳道分组模式下） */
  draggable?: boolean;
  /** 是否处于阻塞状态（Agent 任务等待审批），标红提示 */
  blocked?: boolean;
}

export function WorkItemCard({
  item,
  index,
  onClick,
  completed = false,
  versionMap,
  draggable = true,
  blocked = false,
}: WorkItemCardProps) {
  const priorityCfg = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG[0];
  const priorityBorder =
    PRIORITY_BORDER[item.priority ?? 0] ?? PRIORITY_BORDER[0];
  // 多重防护：列为 end / status 已完成 / 已有 completed_at 的工作项均禁止拖动
  const isCompleted =
    completed || item.status === "completed" || !!item.completed_at;

  // 滞留天数：基于 updated_at（缺失时回退 created_at）
  const daysSinceUpdate = useMemo(() => {
    const ref = item.updated_at || item.created_at;
    if (!ref) return 0;
    const t = new Date(ref).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  }, [item.updated_at, item.created_at]);

  // 已完成的工作项不算滞留
  const isStale = !isCompleted && daysSinceUpdate >= STALE_DAYS_THRESHOLD;

  const versionName =
    item.version_id && versionMap ? versionMap[item.version_id] : undefined;

  const isDragDisabled = isCompleted || !draggable;

  /** 卡片内容（提取为内部渲染，避免 draggable/non-draggable 两处重复） */
  const cardContent = (isDragging = false) => (
    <div
      onClick={() => onClick?.(item)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "group relative rounded-lg border border-l-4 p-3 shadow-card transition-smooth",
        priorityBorder,
        isCompleted
          ? "border-emerald-200/80 bg-emerald-50/60 opacity-90"
          : isStale
            ? "border-amber-200 bg-amber-50/70 ring-1 ring-amber-200/60"
            : "border-border/50 bg-card",
        isDragging
          ? "shadow-card-hover ring-2 ring-primary/30 -rotate-1"
          : onClick
            ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-card-hover"
            : "",
        !isCompleted && !isStale && onClick && !isDragging
          ? "hover:border-primary/30"
          : "",
        blocked && !isCompleted ? "ring-2 ring-red-500" : "",
      )}
    >
      {/* 阻塞徽章 */}
      {blocked && !isCompleted && (
        <span className="absolute -left-1 -top-1 z-10 inline-flex items-center gap-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
          <span className="h-1 w-1 rounded-full bg-white" />
          阻塞
        </span>
      )}
      {/* Status Badge */}
      {item.status && !isCompleted && (
        <span
          className={`absolute right-2 top-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
            STATUS_CONFIG[item.status]?.color ?? "bg-gray-100 text-gray-700"
          }`}
        >
          {STATUS_CONFIG[item.status]?.label ?? item.status}
        </span>
      )}

      {/* DONE marker */}
      {isCompleted && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          DONE
        </span>
      )}

      {/* Title */}
      <div
        className={`mb-2 line-clamp-2 pr-12 text-sm font-medium leading-snug ${
          isCompleted
            ? "text-emerald-900/70 line-through decoration-emerald-600/40"
            : "text-foreground"
        }`}
      >
        {item.title || "(无标题)"}
      </div>

      {/* Priority / Version / Tags */}
      <div className="flex flex-wrap items-center gap-1.5">
        {item.priority > 0 && (
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priorityCfg.color}`}
          >
            {priorityCfg.label}
          </span>
        )}
        {versionName && (
          <span className="inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 border border-indigo-100">
            {versionName}
          </span>
        )}
        {(item.tags ?? []).slice(0, 3).map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className="rounded-md border-border/60 text-[10px] text-muted-foreground"
          >
            {tag}
          </Badge>
        ))}
      </div>

      {/* Footer: assignee + stale/time */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        {item.assignee ? (
          <span className="flex items-center gap-1.5 truncate">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold uppercase text-primary">
              {item.assignee.slice(0, 1)}
            </span>
            <span className="truncate">{item.assignee}</span>
          </span>
        ) : (
          <span />
        )}
        {isStale ? (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
            title={`已 ${daysSinceUpdate} 天未更新`}
          >
            <span className="h-1 w-1 rounded-full bg-amber-500" />
            滞留 {daysSinceUpdate} 天
          </span>
        ) : item.updated_at ? (
          <span className="shrink-0 tabular-nums">
            {formatTime(item.updated_at)}
          </span>
        ) : null}
      </div>
    </div>
  );

  // 非拖拽模式：直接渲染卡片，不需要 DragDropContext
  if (!draggable) {
    return cardContent(false);
  }

  // 拖拽模式：用 Draggable 包裹
  return (
    <Draggable
      draggableId={item.id}
      index={index}
      isDragDisabled={isDragDisabled}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style as React.CSSProperties}
        >
          {cardContent(snapshot.isDragging)}
        </div>
      )}
    </Draggable>
  );
}
