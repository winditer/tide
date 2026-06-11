"use client";

import { Badge } from "@tide/ui";
import { Draggable } from "@hello-pangea/dnd";
import { useRouter } from "next/navigation";
import type { KanbanCard } from "@tide/core";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "secondary",
  pending: "secondary",
  running: "default",
  active: "default",
  review: "outline",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  idle: "outline",
  archived: "outline",
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

function shortenCwd(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length === 0) return cwd;
  return parts[parts.length - 1];
}

function resolveHref(card: KanbanCard): string | null {
  const meta = card.metadata ?? {};
  switch (card.type) {
    case "task":
    case "session":
      return card.id ? `/tasks/${card.id}` : null;
    case "workflow_node": {
      const wf = meta.workflow_id;
      const run = meta.run_id;
      if (wf && run) return `/workflows/${wf}/runs/${run}`;
      if (wf) return `/workflows/${wf}`;
      return null;
    }
    case "project":
      // 项目目前无独立详情页，跳到项目列表
      return "/projects";
    default:
      return null;
  }
}

interface BoardCardProps {
  card: KanbanCard;
  index: number;
}

export function BoardCard({ card, index }: BoardCardProps) {
  const router = useRouter();
  const href = resolveHref(card);
  const meta = card.metadata ?? {};
  const cwd = shortenCwd(meta.cwd);
  const agentId = meta.agent_id;

  const handleClick = (e: React.MouseEvent) => {
    if (!href) return;
    // 避免与拖拽冲突：仅响应主键点击
    if (e.button !== 0) return;
    router.push(href);
  };

  return (
    <Draggable draggableId={card.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style as React.CSSProperties}
          onClick={handleClick}
          role={href ? "button" : undefined}
          tabIndex={href ? 0 : undefined}
          className={`group rounded-lg border border-border/50 bg-card p-3 shadow-card transition-smooth ${
            snapshot.isDragging
              ? "shadow-card-hover ring-2 ring-primary/30 -rotate-1"
              : href
                ? "cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover"
                : ""
          }`}
        >
          <div className="mb-1.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">
            {card.title || "(无标题)"}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={STATUS_VARIANT[card.status] ?? "outline"}
              className="text-[10px] uppercase tracking-wide"
            >
              {card.status}
            </Badge>
            {agentId && (
              <Badge variant="outline" className="text-[10px]">
                {agentId}
              </Badge>
            )}
            {meta.workflow_name && (
              <Badge variant="outline" className="text-[10px]">
                {meta.workflow_name}
              </Badge>
            )}
          </div>

          {(cwd || card.updated_at) && (
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              {cwd ? (
                <span className="truncate" title={meta.cwd}>
                  {cwd}
                </span>
              ) : (
                <span />
              )}
              {card.updated_at && (
                <span className="shrink-0">{formatTime(card.updated_at)}</span>
              )}
            </div>
          )}

          {meta.error && (
            <div
              className="mt-2 truncate rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
              title={String(meta.error)}
            >
              {String(meta.error)}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}
