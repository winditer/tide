"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Draggable } from "@hello-pangea/dnd";
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@tide/ui";
import type { KanbanCard } from "@tide/core";

// Icons (inline SVGs for LayoutGrid, Plus, Eye)
function LayoutGridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function getHealthTooltip(card: KanbanCard): string {
  const meta = card.metadata ?? {};
  const health = meta.health;
  const stats = meta.work_item_stats;
  if (health === "green") return "项目健康";
  if (health === "yellow") {
    const stale = stats?.stale_count ?? 0;
    return `有 ${stale} 个工作项滞留超过3天`;
  }
  if (health === "red") {
    const stale = stats?.stale_count ?? 0;
    const total = stats?.total ?? 0;
    const completed = stats?.completed ?? 0;
    const incomplete = total - completed;
    if (incomplete > 0 && stale / incomplete >= 0.5) {
      return "超过50%工作项滞留";
    }
    return "项目超过7天无活动";
  }
  return "";
}

interface ProjectCardProps {
  card: KanbanCard;
  index: number;
}

export function ProjectCard({ card, index }: ProjectCardProps) {
  const router = useRouter();
  const meta = card.metadata ?? {};
  const workItemStats = meta.work_item_stats ?? { total: 0, completed: 0, stale_count: 0 };
  const members: { user_id: string; display_name: string }[] = meta.members ?? [];
  const health: string = meta.health ?? "green";
  const healthTooltip = getHealthTooltip(card);

  const progressPercent =
    workItemStats.total > 0
      ? (workItemStats.completed / workItemStats.total) * 100
      : 0;

  const handleCardClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't navigate if clicking action buttons
    if ((e.target as HTMLElement).closest("[data-action]")) return;
    router.push(`/projects/${card.id}`);
  };

  return (
    <Draggable draggableId={card.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style as React.CSSProperties}
          onClick={handleCardClick}
          role="button"
          tabIndex={0}
          className={cn(
            "group relative rounded-lg border border-border/50 bg-card p-4 shadow-card transition-smooth",
            snapshot.isDragging
              ? "shadow-card-hover ring-2 ring-primary/30 -rotate-1"
              : "cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover"
          )}
        >
          {/* Health indicator */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "absolute top-3 right-3 w-2.5 h-2.5 rounded-full",
                    health === "green" && "bg-emerald-400",
                    health === "yellow" && "bg-amber-400",
                    health === "red" && "bg-red-400"
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {healthTooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Project name */}
          <h4 className="font-medium text-sm pr-6 line-clamp-1">{card.title || "(无标题)"}</h4>

          {/* Workflow name */}
          {meta.workflow_name && (
            <span className="text-[10px] text-muted-foreground mt-0.5 block">
              {meta.workflow_name}
            </span>
          )}

          {/* Work item progress bar */}
          {workItemStats.total > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                <span>工作项</span>
                <span>
                  {workItemStats.completed}/{workItemStats.total}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Bottom: members + version */}
          <div className="flex items-center justify-between mt-3">
            {/* Member avatars */}
            <div className="flex -space-x-1.5">
              {members.slice(0, 4).map((m) => (
                <div
                  key={m.user_id}
                  className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-[9px] flex items-center justify-center text-indigo-700 dark:text-indigo-300 border border-white dark:border-gray-800"
                  title={m.display_name}
                >
                  {m.display_name?.[0] || "?"}
                </div>
              ))}
              {members.length > 4 && (
                <div className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 text-[9px] flex items-center justify-center text-gray-500 border border-white dark:border-gray-800">
                  +{members.length - 4}
                </div>
              )}
            </div>

            {/* Version info */}
            {meta.active_version && (
              <span className="text-[10px] px-1.5 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 rounded">
                {meta.active_version}
              </span>
            )}
          </div>

          {/* Hover actions */}
          <div
            data-action="true"
            className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1"
          >
            <Link href={`/work-items?project=${card.id}`} onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-6 w-6" title="工作项看板">
                <LayoutGridIcon className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <Link
              href={`/work-items?create=true&project=${card.id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Button variant="ghost" size="icon" className="h-6 w-6" title="创建工作项">
                <PlusIcon className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <Link href={`/projects/${card.id}`} onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-6 w-6" title="项目详情">
                <EyeIcon className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      )}
    </Draggable>
  );
}
