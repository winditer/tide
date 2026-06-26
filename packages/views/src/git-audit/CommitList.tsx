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
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700">
        A
      </span>
    );
  }
  if (s === "D" || s === "DELETED") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700">
        D
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700">
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
      <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
        <GitCommitIcon className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm font-medium">暂无提交记录</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-200">
      {commits.map((commit) => {
        const isExpanded = expandedCommits.has(commit.hash);
        return (
          <div key={commit.hash} className="group">
            {/* Commit row */}
            <div
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-zinc-50 transition-colors"
              onClick={() => toggleExpand(commit.hash)}
            >
              <div className="flex-shrink-0 text-zinc-400">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
              <GitCommitIcon className="h-4 w-4 flex-shrink-0 text-blue-500" />
              <code className="text-xs font-mono text-blue-600 flex-shrink-0">
                {commit.hash.slice(0, 7)}
              </code>
              <span className="text-sm font-medium text-zinc-800 truncate flex-1 min-w-0">
                {commit.message}
              </span>
              <span className="text-xs text-zinc-500 flex-shrink-0">
                {commit.author}
              </span>
              <span className="text-xs text-zinc-400 flex-shrink-0">
                {new Date(commit.date).toLocaleDateString()}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDiff(commit.hash);
                }}
                className="opacity-0 group-hover:opacity-100 flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 transition-all"
              >
                <Eye className="h-3 w-3" />
                Diff
              </button>
            </div>

            {/* Expanded file list */}
            {isExpanded && commit.files && commit.files.length > 0 && (
              <div className="bg-zinc-50/50 border-t border-zinc-100 px-4 py-2">
                <div className="ml-8 space-y-1">
                  {commit.files.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
                      <FileStatusBadge status={file.status} />
                      <span className="font-mono text-xs text-zinc-700 truncate flex-1 min-w-0">
                        {file.path}
                      </span>
                      <span className="flex items-center gap-1 text-xs flex-shrink-0">
                        <span className="text-green-600 flex items-center gap-0.5">
                          <Plus className="h-3 w-3" />
                          {file.additions || 0}
                        </span>
                        <span className="text-red-600 flex items-center gap-0.5">
                          <Minus className="h-3 w-3" />
                          {file.deletions || 0}
                        </span>
                      </span>
                      <button
                        onClick={() => onViewDiff(commit.hash, file.path)}
                        className="text-xs text-blue-600 hover:underline flex-shrink-0"
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
