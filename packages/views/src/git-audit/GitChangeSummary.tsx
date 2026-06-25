"use client";

import { useMemo, useState } from "react";
import {
  GitCommit as GitCommitIcon,
  FileText,
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useGitCommits } from "@tide/core";

interface GitChangeSummaryProps {
  projectId: string;
  workItemId?: string;
  sessionId?: string;
  branch?: string;
  compact?: boolean;
}

export function GitChangeSummary({
  projectId,
  workItemId,
  branch,
  compact = false,
}: GitChangeSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: commits, isLoading } = useGitCommits(projectId, {
    work_item_id: workItemId,
    branch,
    limit: 50,
  });

  const stats = useMemo(() => {
    if (!commits || commits.length === 0) {
      return { commitCount: 0, filesChanged: 0, additions: 0, deletions: 0, files: [] as string[] };
    }
    const fileSet = new Set<string>();
    let additions = 0;
    let deletions = 0;
    for (const commit of commits) {
      for (const file of commit.files ?? []) {
        fileSet.add(file.path);
        additions += file.additions;
        deletions += file.deletions;
      }
    }
    return {
      commitCount: commits.length,
      filesChanged: fileSet.size,
      additions,
      deletions,
      files: Array.from(fileSet).slice(0, 20),
    };
  }, [commits]);

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3">
        <div className="h-4 w-48 bg-zinc-200 dark:bg-zinc-700 rounded" />
      </div>
    );
  }

  if (stats.commitCount === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          <GitCommitIcon className="h-3.5 w-3.5" />
          {stats.commitCount} 提交
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" />
          {stats.filesChanged} 文件
        </span>
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
          <Plus className="h-3 w-3" />
          {stats.additions}
        </span>
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
          <Minus className="h-3 w-3" />
          {stats.deletions}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 overflow-hidden">
      {/* Summary row */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="text-zinc-400">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Git 变更摘要
        </span>
        <div className="flex items-center gap-3 ml-auto text-xs text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1">
            <GitCommitIcon className="h-3.5 w-3.5" />
            {stats.commitCount}
          </span>
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {stats.filesChanged}
          </span>
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <Plus className="h-3 w-3" />
            {stats.additions}
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <Minus className="h-3 w-3" />
            {stats.deletions}
          </span>
        </div>
      </div>

      {/* Expanded file list */}
      {expanded && stats.files.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-2 bg-zinc-50/50 dark:bg-zinc-900/30">
          <div className="space-y-1">
            {stats.files.map((path) => (
              <div
                key={path}
                className="flex items-center gap-2 px-2 py-1 text-xs font-mono text-zinc-600 dark:text-zinc-400"
              >
                <FileText className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{path}</span>
              </div>
            ))}
            {stats.filesChanged > 20 && (
              <p className="text-xs text-zinc-400 px-2 py-1">
                ... 及其他 {stats.filesChanged - 20} 个文件
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
