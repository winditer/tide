"use client";

import { Card, CardContent, Badge } from "@tide/ui";
import type { ProjectGroupSummary } from "@tide/core";

export interface ProjectGroupCardProps {
  group: ProjectGroupSummary;
  onClick?: (group: ProjectGroupSummary) => void;
  onDelete?: (group: ProjectGroupSummary) => void;
  isDeleting?: boolean;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
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

/**
 * 项目组卡片：展示组名、描述、成员数量与基本元信息。
 * 视觉与 ProjectsPage 的项目卡片保持一致（Card + shadow-card）。
 */
export function ProjectGroupCard({
  group,
  onClick,
  onDelete,
  isDeleting,
}: ProjectGroupCardProps) {
  return (
    <Card
      className="group relative bg-card rounded-xl shadow-card transition-smooth hover:shadow-card-hover hover:border-blue-500/40 cursor-pointer"
      onClick={() => onClick?.(group)}
    >
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              GROUP · {group.workspace_id || "default"}
            </div>
            <h3 className="mt-1 truncate text-lg font-semibold tracking-tight">
              {group.name}
            </h3>
          </div>
          <Badge variant="secondary">{group.member_count} 个项目</Badge>
        </div>

        {group.description ? (
          <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
            {group.description}
          </p>
        ) : (
          <p className="mb-4 text-sm italic text-muted-foreground/70">
            未填写描述
          </p>
        )}

        <div className="flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
          <span className="font-mono">{formatTime(group.created_at)}</span>
          {group.created_by && (
            <span className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
              {group.created_by}
            </span>
          )}
        </div>

        {onDelete && (
          <button
            type="button"
            disabled={isDeleting}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(group);
            }}
            className="absolute right-2 top-2 rounded-md border border-border bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-smooth hover:border-destructive hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
          >
            {isDeleting ? "…" : "删除"}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
