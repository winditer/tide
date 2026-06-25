"use client";

import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  GitBranch,
  Wand2,
  Edit3,
  Loader2,
} from "lucide-react";
import { Button, Badge } from "@tide/ui";
import { useConflictDetail, useAIResolveConflict } from "@tide/core";
import { ConflictEditor } from "./ConflictEditor";
import { DiffViewer } from "./DiffViewer";

export interface FileResolution {
  filePath: string;
  status: "pending" | "resolved";
  strategy: "ours" | "theirs" | "manual" | "ai" | null;
  resolvedContent: string | null;
  aiExplanation?: string;
}

interface ConflictFileCardProps {
  projectId: string;
  workItemId?: string;
  cwd: string;
  filePath: string;
  resolution: FileResolution;
  onResolve: (filePath: string, strategy: string, content: string) => void;
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    sh: "shell",
  };
  return map[ext] || "plaintext";
}

export function ConflictFileCard({
  projectId,
  workItemId,
  cwd,
  filePath,
  resolution,
  onResolve,
}: ConflictFileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"diff" | "manual" | "ai" | null>(null);
  const [aiResult, setAiResult] = useState<{
    content: string;
    explanation: string;
  } | null>(null);

  // Lazy load conflict detail only when expanded
  const { data: conflictData, isLoading: isLoadingDetail } = useConflictDetail(
    projectId,
    cwd,
    expanded ? filePath : null,
  );

  const aiMutation = useAIResolveConflict();

  const language = getLanguageFromPath(filePath);

  const handleUseOurs = useCallback(() => {
    if (!conflictData) return;
    onResolve(filePath, "ours", conflictData.ours);
  }, [conflictData, filePath, onResolve]);

  const handleUseTheirs = useCallback(() => {
    if (!conflictData) return;
    onResolve(filePath, "theirs", conflictData.theirs);
  }, [conflictData, filePath, onResolve]);

  const handleManualEdit = useCallback(() => {
    setExpanded(true);
    setMode("manual");
  }, []);

  const handleAIResolve = useCallback(() => {
    if (!conflictData) {
      setExpanded(true);
      setMode("ai");
      return;
    }
    setMode("ai");
    setExpanded(true);
    aiMutation.mutate(
      {
        project_id: projectId,
        work_item_id: workItemId,
        file_path: filePath,
        base_content: conflictData.base,
        ours_content: conflictData.ours,
        theirs_content: conflictData.theirs,
      },
      {
        onSuccess: (result) => {
          setAiResult({
            content: result.resolved_content,
            explanation: result.explanation,
          });
        },
      },
    );
  }, [conflictData, projectId, workItemId, filePath, aiMutation]);

  const handleManualResolve = useCallback(
    (content: string) => {
      onResolve(filePath, "manual", content);
      setMode(null);
    },
    [filePath, onResolve],
  );

  const handleAcceptAI = useCallback(() => {
    if (!aiResult) return;
    onResolve(filePath, "ai", aiResult.content);
    setMode(null);
  }, [aiResult, filePath, onResolve]);

  const statusBadge =
    resolution.status === "resolved" ? (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
        <Check className="mr-0.5 h-3 w-3" />
        已解决 ({resolution.strategy})
      </Badge>
    ) : (
      <Badge variant="outline" className="border-red-200 text-red-700 text-[10px]">
        未解决
      </Badge>
    );

  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 min-w-0 truncate font-mono text-xs text-foreground">
          {filePath}
        </span>
        {statusBadge}
      </div>

      {/* Action buttons (always visible) */}
      {resolution.status === "pending" && (
        <div className="flex items-center gap-1.5 border-t border-border/40 px-3 py-2 bg-muted/20">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              if (!expanded && !conflictData) setExpanded(true);
              handleUseOurs();
            }}
            disabled={!conflictData && !expanded}
          >
            保留源分支
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              if (!expanded && !conflictData) setExpanded(true);
              handleUseTheirs();
            }}
            disabled={!conflictData && !expanded}
          >
            保留目标分支
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              handleManualEdit();
            }}
          >
            <Edit3 className="mr-1 h-3 w-3" />
            手动编辑
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] border-purple-200 text-purple-700 hover:bg-purple-50"
            onClick={(e) => {
              e.stopPropagation();
              handleAIResolve();
            }}
            disabled={aiMutation.isPending}
          >
            {aiMutation.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Wand2 className="mr-1 h-3 w-3" />
            )}
            AI 解决
          </Button>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/40">
          {isLoadingDetail && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-xs text-muted-foreground">加载文件内容…</span>
            </div>
          )}

          {conflictData && mode === "manual" && (
            <div className="h-[400px]">
              <ConflictEditor
                base={conflictData.base}
                ours={conflictData.ours}
                theirs={conflictData.theirs}
                language={language}
                onResolve={handleManualResolve}
              />
            </div>
          )}

          {conflictData && mode === "ai" && (
            <div className="p-3 space-y-3">
              {aiMutation.isPending && (
                <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                  <span className="text-xs text-purple-700">AI 正在分析冲突并生成解决方案…</span>
                </div>
              )}
              {aiMutation.isError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  AI 解决失败：{String(aiMutation.error)}
                </div>
              )}
              {aiResult && (
                <>
                  {aiResult.explanation && (
                    <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3">
                      <p className="text-[11px] font-medium text-purple-800 mb-1">AI 解释：</p>
                      <p className="text-xs text-purple-700 leading-relaxed">{aiResult.explanation}</p>
                    </div>
                  )}
                  <div className="h-[300px] rounded border border-border/50 overflow-hidden">
                    <DiffViewer
                      original={conflictData.ours}
                      modified={aiResult.content}
                      language={language}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        setMode("manual");
                      }}
                    >
                      编辑修改
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-[11px] bg-purple-600 hover:bg-purple-700 text-white"
                      onClick={handleAcceptAI}
                    >
                      <Check className="mr-1 h-3 w-3" />
                      接受 AI 方案
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {conflictData && !mode && resolution.status === "pending" && (
            <div className="h-[300px]">
              <DiffViewer
                original={conflictData.ours}
                modified={conflictData.theirs}
                language={language}
                renderSideBySide
              />
            </div>
          )}

          {conflictData && resolution.status === "resolved" && resolution.resolvedContent && (
            <div className="h-[300px]">
              <DiffViewer
                original={conflictData.ours}
                modified={resolution.resolvedContent}
                language={language}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
