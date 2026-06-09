"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@lark2codex/ui";
import {
  useWorkflow,
  useUpdateWorkflow,
  useRunWorkflow,
  useWorkflowRuns,
} from "@lark2codex/core";
import type { WorkflowDefinition } from "@lark2codex/core";
import { WorkflowCanvas, WorkflowRunHistory } from "@lark2codex/views";

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const router = useRouter();

  const { data: workflow, isLoading, isError, error } = useWorkflow(id);
  const update = useUpdateWorkflow();
  const run = useRunWorkflow();
  const { data: runs, isLoading: runsLoading } = useWorkflowRuns(id, 5000);

  const [draft, setDraft] = useState<WorkflowDefinition | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (workflow?.definition && draft === null) {
      setDraft(workflow.definition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.id]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING WORKFLOW…
        </div>
      </div>
    );
  }

  if (isError || !workflow) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-xs text-rose-600">
          ✕ 加载失败 — {String(error)}
        </div>
      </div>
    );
  }

  const handleSave = (def: WorkflowDefinition) => {
    update.mutate(
      { id, params: { definition: def } },
      {
        onSuccess: () => {
          setDirty(false);
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
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      {/* Header strip */}
      <div className="flex items-center justify-between border-2 border-zinc-900 bg-white px-4 py-3 shadow-[5px_5px_0_0_rgba(24,24,27,0.92)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/workflows")}
              className="font-mono text-[11px] tracking-widest text-zinc-500 hover:text-zinc-900"
            >
              ◀ WORKFLOWS
            </button>
            <span className="font-mono text-[11px] text-zinc-300">/</span>
            <span className="font-mono text-[11px] tracking-widest text-zinc-700">
              EDIT
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <h1 className="truncate text-xl font-black tracking-tight text-zinc-900">
              {workflow.name}
            </h1>
            <span className="border border-zinc-300 bg-zinc-50 px-1.5 py-[1px] font-mono text-[10px] tracking-widest text-zinc-700">
              v{workflow.version}
            </span>
            {dirty && (
              <span className="border border-amber-500 bg-amber-50 px-1.5 py-[1px] font-mono text-[10px] tracking-widest text-amber-800">
                ◇ UNSAVED
              </span>
            )}
          </div>
          {workflow.description && (
            <p className="mt-1 max-w-2xl truncate text-xs text-zinc-600">
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
