"use client";

import { useState } from "react";
import {
  GitCommit as GitCommitIcon,
  ChevronRight,
  ChevronDown,
  FileText,
  Plus,
  Minus,
  Eye,
} from "lucide-react";
import type { GitCommit } from "@tide/core";

interface CommitListProps {
  commits: GitCommit[];
  onViewDiff: (hash: string, filePath?: string) => void;
}

function FileStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === "A" || s === "ADDED") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        A
      </span>
    );
  }
  if (s === "D" || s === "DELETED") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        D
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
      M
    </span>
  );
}

export function CommitList({ commits, onViewDiff }: CommitListProps) {
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  const toggleExpand = (hash: string) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-500 dark:text-zinc-400">
        <GitCommitIcon className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">暂无提交记录</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-700/50">
      {commits.map((commit) => {
        const isExpanded = expandedCommits.has(commit.hash);
        return (
          <div key={commit.hash} className="group">
            {/* Commit row */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              onClick={() => toggleExpand(commit.hash)}
            >
              <div className="flex-shrink-0 text-zinc-400">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
              <GitCommitIcon className="h-4 w-4 flex-shrink-0 text-blue-500 dark:text-blue-400" />
              <code className="text-xs font-mono text-blue-600 dark:text-blue-400 flex-shrink-0">
                {commit.hash.slice(0, 7)}
              </code>
              <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate flex-1 min-w-0">
                {commit.message}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex-shrink-0">
                {commit.author}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 flex-shrink-0">
                {new Date(commit.date).toLocaleDateString()}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDiff(commit.hash);
                }}
                className="opacity-0 group-hover:opacity-100 flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 transition-all"
              >
                <Eye className="h-3 w-3" />
                Diff
              </button>
            </div>

            {/* Expanded file list */}
            {isExpanded && commit.files && commit.files.length > 0 && (
              <div className="bg-zinc-50/50 dark:bg-zinc-800/30 border-t border-zinc-100 dark:border-zinc-700/30 px-4 py-2">
                <div className="ml-8 space-y-1">
                  {commit.files.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white dark:hover:bg-zinc-700/50 transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
                      <FileStatusBadge status={file.status} />
                      <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate flex-1 min-w-0">
                        {file.path}
                      </span>
                      <span className="flex items-center gap-1 text-xs flex-shrink-0">
                        <span className="text-green-600 dark:text-green-400 flex items-center gap-0.5">
                          <Plus className="h-3 w-3" />
                          {file.additions || 0}
                        </span>
                        <span className="text-red-600 dark:text-red-400 flex items-center gap-0.5">
                          <Minus className="h-3 w-3" />
                          {file.deletions || 0}
                        </span>
                      </span>
                      <button
                        onClick={() => onViewDiff(commit.hash, file.path)}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                      >
                        查看 diff
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
