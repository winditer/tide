"use client";

import { useMemo } from "react";
import { useCommitDiff, useFileDiff } from "@tide/core";
import { DiffViewer } from "../code-editor/DiffViewer";
import { Loader2, AlertCircle } from "lucide-react";

interface DiffPanelProps {
  projectId: string;
  /** commit hash for committed file diffs. undefined/empty for uncommitted diffs. */
  commitHash?: string;
  filePath?: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

function getLanguageFromPath(filePath?: string): string {
  if (!filePath) return "plaintext";
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    toml: "toml",
    xml: "xml",
  };
  return langMap[ext ?? ""] ?? "plaintext";
}

/**
 * 从完整 diff 内容中提取指定文件的 diff 部分。
 */
function extractFileDiff(fullDiff: string, filePath: string): string | null {
  // Split by "diff --git" boundaries
  const sections = fullDiff.split(/(?=^diff --git )/m);
  for (const section of sections) {
    // Match "diff --git a/path b/path"
    if (
      section.includes(`a/${filePath}`) &&
      section.includes(`b/${filePath}`)
    ) {
      return section;
    }
    // Also try matching just the filename at end of path
    // for cases where the path format differs
    const match = section.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    if (match && (match[1] === filePath || match[2] === filePath)) {
      return section;
    }
  }
  return null;
}

/**
 * 解析 unified diff 为 original/modified 文本对。
 */
function parseDiff(diff: string): { original: string; modified: string } {
  const lines = diff.split("\n");
  const original: string[] = [];
  const modified: string[] = [];

  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith("-")) {
      original.push(line.slice(1));
    } else if (line.startsWith("+")) {
      modified.push(line.slice(1));
    } else {
      // context line (starts with space or is empty)
      const content = line.startsWith(" ") ? line.slice(1) : line;
      original.push(content);
      modified.push(content);
    }
  }

  return { original: original.join("\n"), modified: modified.join("\n") };
}

export function DiffPanel({ projectId, commitHash, filePath, isFullscreen, onToggleFullscreen }: DiffPanelProps) {
  const isCommittedDiff = !!commitHash;

  // For committed files: use commit diff API
  const {
    data: commitDiffContent,
    isLoading: commitLoading,
    error: commitError,
  } = useCommitDiff(projectId, isCommittedDiff ? commitHash : null);

  // For uncommitted files: use file diff API (working dir vs HEAD)
  const {
    data: fileDiffContent,
    isLoading: fileLoading,
    error: fileError,
  } = useFileDiff(
    !isCommittedDiff ? projectId : undefined,
    undefined,
    undefined,
    filePath,
  );

  const isLoading = isCommittedDiff ? commitLoading : fileLoading;
  const error = isCommittedDiff ? commitError : fileError;

  // For committed diffs, extract the specific file's portion
  const diffContent = useMemo(() => {
    if (isCommittedDiff) {
      if (!commitDiffContent) return null;
      if (filePath) {
        return extractFileDiff(commitDiffContent, filePath) ?? commitDiffContent;
      }
      return commitDiffContent;
    }
    return fileDiffContent ?? null;
  }, [isCommittedDiff, commitDiffContent, fileDiffContent, filePath]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        <span className="ml-2 text-sm text-zinc-500">加载 diff 中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full py-12 text-red-500">
        <AlertCircle className="h-5 w-5 mr-2" />
        <span className="text-sm">加载失败: {(error as Error).message}</span>
      </div>
    );
  }

  if (!diffContent) {
    return (
      <div className="flex items-center justify-center h-full py-12 text-zinc-400">
        <span className="text-sm">无 diff 内容</span>
      </div>
    );
  }

  const { original, modified } = parseDiff(diffContent);
  const language = getLanguageFromPath(filePath);

  return (
    <div className="h-full w-full overflow-hidden">
      <DiffViewer
        original={original}
        modified={modified}
        language={language}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    </div>
  );
}
