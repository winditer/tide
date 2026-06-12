"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@tide/ui";
import {
  useWorkflow,
  useUpdateWorkflow,
  useRunWorkflow,
  useWorkflowRuns,
} from "@tide/core";
import type { WorkflowDefinition } from "@tide/core";
import { WorkflowCanvas, WorkflowRunHistory } from "@tide/views";

export default function WorkflowEditorPage() {
  return (
    <Suspense fallback={null}>
      <WorkflowEditorPageInner />
    </Suspense>
  );
}

function WorkflowEditorPageInner() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams?.get("projectId") || undefined;

  const { data: workflow, isLoading, isError, error } = useWorkflow(id);
  const update = useUpdateWorkflow();
  const run = useRunWorkflow();
  const { data: runs, isLoading: runsLoading } = useWorkflowRuns(id, 5000);

  const [draft, setDraft] = useState<WorkflowDefinition | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (workflow?.definition && !dirty) {
      setDraft(workflow.definition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.definition]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">加载工作流中…</div>
      </div>
    );
  }

  if (isError || !workflow) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-destructive">加载失败 — {String(error)}</div>
      </div>
    );
  }

  const handleSave = (def: WorkflowDefinition) => {
    update.mutate(
      { id, params: { definition: def } },
      {
        onSuccess: (data) => {
          setDirty(false);
          if (data?.definition) {
            setDraft(data.definition);
          }
        },
      }
    );
  };

  const handleRun = () => {
    if (dirty) {
      if (!confirm("有未保存的修改，仍要运行当前已保存版本？")) return;
    }
    run.mutate(
      { id, body: { input_context: {} } },
      {
        onSuccess: (newRun) => {
          router.push(`/workflows/${id}/runs/${newRun.id}`);
        },
      }
    );
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-6">
      {/* Header strip */}
      <div className="flex items-center justify-between bg-card rounded-xl shadow-card px-5 py-4">
        <div className="min-w-0">
          <button
            onClick={() => router.push("/workflows")}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-smooth"
          >
            ← 返回工作流列表
          </button>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {workflow.name}
            </h1>
            <span className="rounded-md border border-border bg-muted px-1.5 py-[1px] font-mono text-[10px] tracking-widest text-muted-foreground">
              v{workflow.version}
            </span>
            {dirty && (
              <span className="rounded-md border border-amber-500/50 bg-amber-50 px-1.5 py-[1px] font-mono text-[10px] tracking-widest text-amber-700">
                未保存
              </span>
            )}
          </div>
          {workflow.description && (
            <p className="mt-1 max-w-2xl truncate text-sm text-muted-foreground">
              {workflow.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/workflows")}
          >
            返回列表
          </Button>
        </div>
      </div>

      {/* Canvas (main work area) */}
      <div className="min-h-[600px] flex-1">
        <WorkflowCanvas
          definition={draft ?? workflow.definition}
          subtitle={workflow.name}
          projectId={projectId}
          onChange={(def) => {
            setDraft(def);
            setDirty(true);
          }}
          onSave={handleSave}
          onRun={handleRun}
          isSaving={update.isPending}
          isRunning={run.isPending}
        />
      </div>

      {/* Run history */}
      <WorkflowRunHistory
        workflowId={id}
        runs={runs ?? []}
        isLoading={runsLoading}
      />
    </div>
  );
}
