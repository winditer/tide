"use client";

import { Badge } from "@tide/ui";
import { Draggable } from "@hello-pangea/dnd";
import type { WorkItem } from "@tide/core";

const PRIORITY_CONFIG: Record<number, { label: string; color: string }> = {
  0: { label: "无", color: "bg-zinc-200 text-zinc-600" },
  1: { label: "低", color: "bg-blue-100 text-blue-700 border-blue-300" },
  2: { label: "中", color: "bg-amber-100 text-amber-700 border-amber-300" },
  3: { label: "高", color: "bg-orange-100 text-orange-700 border-orange-300" },
  4: { label: "紧急", color: "bg-rose-100 text-rose-700 border-rose-300" },
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
          onClick={() => onClick?.(item)}
          role={onClick ? "button" : undefined}
          tabIndex={onClick ? 0 : undefined}
          className={`group relative rounded-lg border-2 p-3 transition-all ${
            completed
              ? "border-emerald-600/70 bg-emerald-50/80 shadow-[3px_3px_0_0_rgba(5,150,105,0.55)] opacity-85"
              : "border-zinc-900 bg-white shadow-[3px_3px_0_0_rgba(24,24,27,0.85)]"
          } ${
            snapshot.isDragging
              ? "shadow-[6px_6px_0_0_rgba(24,24,27,0.92)] ring-2 ring-emerald-400/50"
              : !completed && onClick
                ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_rgba(24,24,27,0.92)]"
                : completed && onClick
                  ? "cursor-pointer hover:-translate-y-0.5"
                  : ""
          }`}
        >
          {/* DONE marker */}
          {completed && (
            <span className="absolute -right-1.5 -top-1.5 rounded-sm border-2 border-emerald-700 bg-emerald-500 px-1.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider text-white shadow-[2px_2px_0_0_rgba(5,150,105,0.6)]">
              DONE
            </span>
          )}

          {/* Title */}
          <div
            className={`mb-2 line-clamp-2 text-sm font-semibold leading-snug ${
              completed
                ? "text-emerald-900/70 line-through decoration-emerald-700/60 decoration-2"
                : "text-zinc-900"
            }`}
          >
            {item.title || "(无标题)"}
          </div>

          {/* Priority & Tags */}
          <div className="flex flex-wrap items-center gap-1.5">
            {item.priority > 0 && (
              <span
                className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide ${priorityCfg.color}`}
              >
                {priorityCfg.label}
              </span>
            )}
            {(item.tags ?? []).slice(0, 3).map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="border-zinc-300 text-[10px] text-zinc-600"
              >
                {tag}
              </Badge>
            ))}
          </div>

          {/* Footer: assignee + time */}
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
            {item.assignee ? (
              <span className="truncate font-mono">{item.assignee}</span>
            ) : (
              <span />
            )}
            {item.updated_at && (
              <span className="shrink-0 font-mono">
                {formatTime(item.updated_at)}
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}
