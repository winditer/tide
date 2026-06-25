"use client";

import { useState, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  GitMerge,
  ArrowRight,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Button, Badge } from "@tide/ui";
import {
  useResolveConflict,
  useResolveMerge,
} from "@tide/core";
import { ConflictFileCard, type FileResolution } from "./ConflictFileCard";

interface MergeConflictPanelProps {
  projectId: string;
  workItemId?: string;
  runId?: string;
  nodeId?: string;
  cwd: string;
  sourceBranch: string;
  targetBranch: string;
  conflictFiles: string[];
  onResolved?: () => void;
  onAbort?: () => void;
}

export function MergeConflictPanel({
  projectId,
  workItemId,
  runId,
  nodeId,
  cwd,
  sourceBranch,
  targetBranch,
  conflictFiles,
  onResolved,
  onAbort,
}: MergeConflictPanelProps) {
  const [resolutions, setResolutions] = useState<Record<string, FileResolution>>(
    () => {
      const initial: Record<string, FileResolution> = {};
      for (const fp of conflictFiles) {
        initial[fp] = {
          filePath: fp,
          status: "pending",
          strategy: null,
          resolvedContent: null,
        };
      }
      return initial;
    },
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveConflictMutation = useResolveConflict();
  const resolveMergeMutation = useResolveMerge();

  const allResolved = useMemo(
    () => Object.values(resolutions).every((r) => r.status === "resolved"),
    [resolutions],
  );

  const resolvedCount = useMemo(
    () => Object.values(resolutions).filter((r) => r.status === "resolved").length,
    [resolutions],
  );

  const handleFileResolve = useCallback(
    (filePath: string, strategy: string, content: string) => {
      setResolutions((prev) => ({
        ...prev,
        [filePath]: {
          ...prev[filePath],
          status: "resolved",
          strategy: strategy as FileResolution["strategy"],
          resolvedContent: content,
        },
      }));
    },
    [],
  );

  const handleBulkOurs = useCallback(() => {
    // We need conflict data for each file - for bulk operations we just mark them
    // The actual content will be fetched during submit
    setResolutions((prev) => {
      const updated = { ...prev };
      for (const fp of conflictFiles) {
        if (updated[fp].status === "pending") {
          updated[fp] = {
            ...updated[fp],
            status: "resolved",
            strategy: "ours",
            resolvedContent: null, // Will be filled during submit
          };
        }
      }
      return updated;
    });
  }, [conflictFiles]);

  const handleBulkTheirs = useCallback(() => {
    setResolutions((prev) => {
      const updated = { ...prev };
      for (const fp of conflictFiles) {
        if (updated[fp].status === "pending") {
          updated[fp] = {
            ...updated[fp],
            status: "resolved",
            strategy: "theirs",
            resolvedContent: null, // Will be filled during submit
          };
        }
      }
      return updated;
    });
  }, [conflictFiles]);

  const handleSubmit = useCallback(async () => {
    if (!allResolved || !workItemId) return;
    setIsSubmitting(true);
    setError(null);

    try {
      // For files that have resolvedContent, submit them
      for (const res of Object.values(resolutions)) {
        if (res.resolvedContent) {
          await resolveConflictMutation.mutateAsync({
            projectId,
            cwd,
            filePath: res.filePath,
            resolvedContent: res.resolvedContent,
          });
        }
      }

      // Complete the merge
      await resolveMergeMutation.mutateAsync({
        workItemId,
        data: {
          resolved: true,
          message: `Resolved ${conflictFiles.length} conflict(s): ${sourceBranch} → ${targetBranch}`,
        },
      });

      onResolved?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
      setShowConfirm(false);
    }
  }, [
    allResolved,
    workItemId,
    resolutions,
    resolveConflictMutation,
    resolveMergeMutation,
    projectId,
    cwd,
    conflictFiles.length,
    sourceBranch,
    targetBranch,
    onResolved,
  ]);

  const handleAbort = useCallback(async () => {
    if (!workItemId) return;
    setIsSubmitting(true);
    setError(null);

    try {
      await resolveMergeMutation.mutateAsync({
        workItemId,
        data: {
          resolved: false,
          message: `Aborted merge: ${sourceBranch} → ${targetBranch}`,
        },
      });
      onAbort?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [workItemId, resolveMergeMutation, sourceBranch, targetBranch, onAbort]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-amber-200/70 bg-card p-4 shadow-card">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-amber-700" />
            合并冲突
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-mono">
              {sourceBranch}
            </Badge>
            <ArrowRight className="h-3 w-3" />
            <Badge variant="outline" className="text-[10px] font-mono">
              {targetBranch}
            </Badge>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            冲突文件 ({conflictFiles.length}) · 已解决 {resolvedCount}/{conflictFiles.length}
          </p>
        </div>
      </div>

      {/* File cards */}
      <div className="space-y-2">
        {conflictFiles.map((fp) => (
          <ConflictFileCard
            key={fp}
            projectId={projectId}
            workItemId={workItemId}
            cwd={cwd}
            filePath={fp}
            resolution={resolutions[fp]}
            onResolve={handleFileResolve}
          />
        ))}
      </div>

      {/* Bulk actions + submit */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={handleBulkOurs}
          disabled={isSubmitting || allResolved}
        >
          全部保留源分支
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={handleBulkTheirs}
          disabled={isSubmitting || allResolved}
        >
          全部保留目标分支
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-[11px]"
            onClick={handleAbort}
            disabled={isSubmitting}
          >
            {isSubmitting && resolveMergeMutation.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <X className="mr-1 h-3 w-3" />
            )}
            放弃合并
          </Button>
          <Button
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setShowConfirm(true)}
            disabled={!allResolved || isSubmitting}
          >
            <Check className="mr-1 h-3 w-3" />
            提交解决方案
          </Button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h4 className="text-sm font-semibold text-foreground">确认提交解决方案</h4>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              将提交 {conflictFiles.length} 个文件的冲突解决方案，并推进合并流程。
              <br />
              <span className="font-mono text-[10px]">
                {sourceBranch} → {targetBranch}
              </span>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirm(false)}
                disabled={isSubmitting}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    提交中…
                  </>
                ) : (
                  "确认提交"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
