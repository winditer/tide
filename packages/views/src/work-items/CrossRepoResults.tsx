"use client";

import { useState } from "react";
import { GitCommit, ChevronRight, Copy, Check } from "lucide-react";
import { Badge } from "@tide/ui";
import {
  useWorkItemCrossRepoResults,
  appPath,
  type CrossRepoResultItem,
} from "@tide/core";

/**
 * 工作项跨仓库执行结果聚合视图。
 *
 * 仅当工作项关联了项目组（``group_id``）且后端已生成跨仓库 Plan 时才会
 * 渲染。每个仓库渲染为一张卡片，展示其状态、commit、diff 概要。
 */
interface CrossRepoResultsProps {
  workItemId: string;
  /** 是否为项目组工作项（无 group_id 时不发起请求，组件折叠不显示） */
  enabled?: boolean;
}

export function CrossRepoResults({ workItemId, enabled = true }: CrossRepoResultsProps) {
  const { data, isLoading } = useWorkItemCrossRepoResults(
    enabled && workItemId ? workItemId : undefined
  );

  // 非项目组工作项 / 未生成 Plan / 后端返回空 → 不渲染
  if (!enabled) return null;
  if (isLoading) return null;
  const results = data?.results ?? [];
  if (!data || !data.group_id || results.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            跨仓库执行结果
          </span>
          <Badge
            variant="outline"
            className="rounded-md border-primary/30 bg-primary/5 text-[10px] text-primary"
          >
            {results.length} 个仓库
          </Badge>
        </div>
        {data.plan_id && (
          <a
            href={appPath(`/plans/${data.plan_id}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-primary transition-smooth hover:text-primary/80 hover:underline"
          >
            查看 Plan ↗
          </a>
        )}
      </div>

      <div className="space-y-2">
        {results.map((item) => (
          <RepoResultCard key={item.task_id} item={item} />
        ))}
      </div>
    </div>
  );
}

function RepoResultCard({ item }: { item: CrossRepoResultItem }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasDiff = !!(item.diff_summary && item.diff_summary.trim().length > 0);
  const expandable = hasDiff;
  const shortHash = item.commit_hash ? item.commit_hash.slice(0, 7) : null;
  const projectName =
    item.project_name || (item.cwd ? item.cwd.split("/").pop() : null) || "未知仓库";

  const handleCopyHash = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.commit_hash) return;
    try {
      await navigator.clipboard.writeText(item.commit_hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略复制失败
    }
  };

  return (
    <div className="group rounded-lg border border-border/50 bg-card shadow-card transition-smooth hover:shadow-card-hover">
      <button
        type="button"
        onClick={() => expandable && setExpanded((v) => !v)}
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${
          expandable ? "cursor-pointer" : "cursor-default"
        }`}
        aria-expanded={expanded}
      >
        {/* 状态指示点 + 仓库名 */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <StatusDot status={item.status} />
          <span className="truncate text-sm font-medium text-foreground">
            {projectName}
          </span>
          <StatusBadge status={item.status} />
        </div>

        {/* commit hash 短码（可复制） */}
        {shortHash && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleCopyHash}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCopyHash(e as unknown as React.MouseEvent);
              }
            }}
            className="flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground transition-smooth hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            title={`点击复制完整 hash: ${item.commit_hash}`}
          >
            <GitCommit className="h-3 w-3" />
            {shortHash}
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3 opacity-0 transition-smooth group-hover:opacity-60" />
            )}
          </span>
        )}

        {/* 任务详情链接 */}
        <a
          href={appPath(`/tasks/${item.task_id}`)}
          onClick={(e) => e.stopPropagation()}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[11px] font-medium text-primary opacity-0 transition-smooth hover:underline group-hover:opacity-100"
        >
          任务 →
        </a>

        {/* 展开箭头 */}
        {expandable && (
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
        )}
      </button>

      {/* 展开区：commit message + diff summary */}
      {expandable && expanded && (
        <div className="border-t border-border/40 bg-muted/20 px-3 py-3">
          {item.commit_message && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Commit Message
              </div>
              <p className="rounded-md border-l-2 border-primary/40 bg-background/70 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/90">
                {item.commit_message}
              </p>
            </div>
          )}
          {hasDiff && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Diff Summary
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border/40 bg-zinc-950 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-100">
                {item.diff_summary}
              </pre>
            </div>
          )}
          {item.cwd && (
            <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground/70">
              {item.cwd}
            </div>
          )}
        </div>
      )}

      {/* 收起态下若无 diff，仍展示 commit message 一行（更紧凑） */}
      {!expanded && !hasDiff && item.commit_message && (
        <div className="border-t border-border/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          {item.commit_message}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status?: string | null }) {
  const tone = mapStatusTone(status);
  return (
    <span
      className={`relative flex h-2 w-2 shrink-0 items-center justify-center rounded-full ${tone.dotBg}`}
      aria-hidden
    >
      {tone.pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone.dotBg}`}
        />
      )}
    </span>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const tone = mapStatusTone(status);
  return (
    <Badge
      variant="outline"
      className={`shrink-0 rounded-md text-[10px] ${tone.badgeBorder} ${tone.badgeText} ${tone.badgeBg}`}
    >
      {tone.label}
    </Badge>
  );
}

function mapStatusTone(status?: string | null) {
  switch ((status || "").toLowerCase()) {
    case "completed":
    case "success":
    case "done":
      return {
        label: "已完成",
        pulse: false,
        dotBg: "bg-emerald-500",
        badgeBorder: "border-emerald-200",
        badgeBg: "bg-emerald-50",
        badgeText: "text-emerald-700",
      };
    case "running":
    case "in_progress":
      return {
        label: "进行中",
        pulse: true,
        dotBg: "bg-sky-500",
        badgeBorder: "border-sky-200",
        badgeBg: "bg-sky-50",
        badgeText: "text-sky-700",
      };
    case "failed":
    case "error":
      return {
        label: "失败",
        pulse: false,
        dotBg: "bg-rose-500",
        badgeBorder: "border-rose-200",
        badgeBg: "bg-rose-50",
        badgeText: "text-rose-700",
      };
    case "stopped":
    case "cancelled":
      return {
        label: "已停止",
        pulse: false,
        dotBg: "bg-zinc-400",
        badgeBorder: "border-zinc-200",
        badgeBg: "bg-zinc-50",
        badgeText: "text-zinc-600",
      };
    case "pending_approval":
    case "approving":
      return {
        label: "待审批",
        pulse: true,
        dotBg: "bg-amber-500",
        badgeBorder: "border-amber-200",
        badgeBg: "bg-amber-50",
        badgeText: "text-amber-700",
      };
    case "queued":
    case "pending":
    default:
      return {
        label: status || "排队中",
        pulse: false,
        dotBg: "bg-zinc-300",
        badgeBorder: "border-border/60",
        badgeBg: "bg-muted/40",
        badgeText: "text-muted-foreground",
      };
  }
}
