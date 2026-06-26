"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  ChevronRight,
  ChevronDown,
  GitCommit as GitCommitIcon,
  Plus,
  Minus,
} from "lucide-react";
import type { GitCommit } from "@tide/core";

interface FileChangeListProps {
  commits: GitCommit[];
  onViewDiff: (hash: string, filePath: string) => void;
}

interface FileAggregation {
  path: string;
  changeCount: number;
  totalAdditions: number;
  totalDeletions: number;
  commits: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
}

export function FileChangeList({ commits, onViewDiff }: FileChangeListProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const fileAggregations = useMemo(() => {
    const map = new Map<string, FileAggregation>();
    for (const commit of commits) {
      for (const file of commit.files ?? []) {
        let entry = map.get(file.path);
        if (!entry) {
          entry = {
            path: file.path,
            changeCount: 0,
            totalAdditions: 0,
            totalDeletions: 0,
            commits: [],
          };
          map.set(file.path, entry);
        }
        entry.changeCount += 1;
        entry.totalAdditions += file.additions;
        entry.totalDeletions += file.deletions;
        entry.commits.push({
          hash: commit.hash,
          message: commit.message,
          author: commit.author,
          date: commit.date,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.changeCount - a.changeCount,
    );
  }, [commits]);

  const toggleExpand = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (fileAggregations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
        <FileText className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm font-medium">暂无文件变更</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-200">
      {fileAggregations.map((file) => {
        const isExpanded = expandedFiles.has(file.path);
        return (
          <div key={file.path}>
            <div
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-zinc-50 transition-colors"
              onClick={() => toggleExpand(file.path)}
            >
              <div className="flex-shrink-0 text-zinc-400">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
              <FileText className="h-4 w-4 flex-shrink-0 text-zinc-500" />
              <span className="font-mono text-sm font-medium text-zinc-800 truncate flex-1 min-w-0">
                {file.path}
              </span>
              <span className="text-xs text-zinc-500 flex-shrink-0">
                {file.changeCount} 次修改
              </span>
              <span className="flex items-center gap-2 text-xs flex-shrink-0">
                <span className="text-green-600 flex items-center gap-0.5">
                  <Plus className="h-3 w-3" />
                  {file.totalAdditions}
                </span>
                <span className="text-red-600 flex items-center gap-0.5">
                  <Minus className="h-3 w-3" />
                  {file.totalDeletions}
                </span>
              </span>
            </div>

            {isExpanded && (
              <div className="bg-zinc-50/50 border-t border-zinc-100 px-4 py-2">
                <div className="ml-8 space-y-1">
                  {file.commits.map((c) => (
                    <div
                      key={c.hash}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white transition-colors"
                    >
                      <GitCommitIcon className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                      <code className="text-xs font-mono text-blue-600 flex-shrink-0">
                        {c.hash.slice(0, 7)}
                      </code>
                      <span className="text-xs text-zinc-700 truncate flex-1 min-w-0">
                        {c.message}
                      </span>
                      <span className="text-xs text-zinc-400 flex-shrink-0">
                        {new Date(c.date).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => onViewDiff(c.hash, file.path)}
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
