"use client";

import { Badge } from "@tide/ui";
import { Draggable } from "@hello-pangea/dnd";
import type { WorkItem } from "@tide/core";

const PRIORITY_CONFIG: Record<number, { label: string; color: string }> = {
  0: { label: "无", color: "bg-muted text-muted-foreground" },
  1: { label: "低", color: "bg-blue-50 text-blue-700 border border-blue-200" },
  2: { label: "中", color: "bg-amber-50 text-amber-700 border border-amber-200" },
  3: { label: "高", color: "bg-orange-50 text-orange-700 border border-orange-200" },
  4: { label: "紧急", color: "bg-rose-50 text-rose-700 border border-rose-200" },
};

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
}

export function WorkItemCard({
  item,
  index,
  onClick,
  completed = false,
}: WorkItemCardProps) {
  const priorityCfg = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG[0];

  return (
    <Draggable draggableId={item.id} index={index} isDragDisabled={completed}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style as React.CSSProperties}
          onClick={() => onClick?.(item)}
          role={onClick ? "button" : undefined}
          tabIndex={onClick ? 0 : undefined}
          className={`group relative rounded-lg border p-3 shadow-card transition-smooth ${
            completed
              ? "border-emerald-200/80 bg-emerald-50/60 opacity-90"
              : "border-border/50 bg-card"
          } ${
            snapshot.isDragging
              ? "shadow-card-hover ring-2 ring-primary/30 -rotate-1"
              : !completed && onClick
                ? "cursor-pointer hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover"
                : completed && onClick
                  ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-card-hover"
                  : ""
          }`}
        >
          {/* DONE marker */}
          {completed && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              DONE
            </span>
          )}

          {/* Title */}
          <div
            className={`mb-2 line-clamp-2 pr-12 text-sm font-medium leading-snug ${
              completed
                ? "text-emerald-900/70 line-through decoration-emerald-600/40"
                : "text-foreground"
            }`}
          >
            {item.title || "(无标题)"}
          </div>

          {/* Priority & Tags */}
          <div className="flex flex-wrap items-center gap-1.5">
            {item.priority > 0 && (
              <span
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priorityCfg.color}`}
              >
                {priorityCfg.label}
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

          {/* Footer: assignee + time */}
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
            {item.updated_at && (
              <span className="shrink-0 tabular-nums">
                {formatTime(item.updated_at)}
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}
