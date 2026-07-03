"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, toast } from "@tide/ui";
import {
  useWorkflow,
  useUpdateWorkflow,
  useRunWorkflow,
  useWorkflowRuns,
  useAuth,
} from "@tide/core";
import type { WorkflowDefinition } from "@tide/core";
import { WorkflowCanvas, WorkflowRunHistory } from "@tide/views";
import { Pencil } from "lucide-react";

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
  const { user } = useAuth();

  // 判断当前用户是否可以编辑此工作流
  const canEdit = (() => {
    if (!user) return true; // 未登录不限制
    if (user.role === "admin") return true;
    if (user.role === "viewer") return false;
    // member 只能编辑自己创建的
    return workflow?.created_by != null && workflow.created_by === user.id;
  })();

  const [draft, setDraft] = useState<WorkflowDefinition | null>(null);
  const [dirty, setDirty] = useState(false);

  // ─── Inline editing for name & description ─────────────
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [descValue, setDescValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);

  const startEditName = useCallback(() => {
    setNameValue(workflow?.name ?? "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [workflow?.name]);

  const saveName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === workflow?.name) return;
    update.mutate(
      { id, params: { name: trimmed } },
      { onError: (err) => toast({ title: "保存名称失败", description: String(err instanceof Error ? err.message : err), variant: "destructive" }) },
    );
  }, [nameValue, workflow?.name, id, update]);

  const startEditDesc = useCallback(() => {
    setDescValue(workflow?.description ?? "");
    setEditingDesc(true);
    setTimeout(() => descInputRef.current?.focus(), 0);
  }, [workflow?.description]);

  const saveDesc = useCallback(() => {
    setEditingDesc(false);
    const trimmed = descValue.trim();
    if (trimmed === (workflow?.description ?? "")) return;
    update.mutate(
      { id, params: { description: trimmed } },
      { onError: (err) => toast({ title: "保存描述失败", description: String(err instanceof Error ? err.message : err), variant: "destructive" }) },
    );
  }, [descValue, workflow?.description, id, update]);

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
        onError: (err) => {
          toast({
            title: "保存失败",
            description: String(err instanceof Error ? err.message : err),
            variant: "destructive",
          });
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
            {editingName ? (
              <Input
                ref={nameInputRef}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="text-2xl font-semibold h-auto py-0 px-1 max-w-md"
              />
            ) : (
              <h1
                className={`truncate text-2xl font-semibold tracking-tight transition-colors ${canEdit ? "group cursor-pointer hover:text-primary/80" : ""}`}
                onClick={canEdit ? startEditName : undefined}
                title={canEdit ? "点击编辑名称" : undefined}
              >
                {workflow.name}
                {canEdit && <Pencil className="inline-block ml-1.5 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
              </h1>
            )}
            <span className="rounded-md border border-border bg-muted px-1.5 py-[1px] font-mono text-[10px] tracking-widest text-muted-foreground">
              v{workflow.version}
            </span>
            {dirty && (
              <span className="rounded-md border border-amber-500/50 bg-amber-50 px-1.5 py-[1px] font-mono text-[10px] tracking-widest text-amber-700">
                未保存
              </span>
            )}
          </div>
          {editingDesc ? (
            <Input
              ref={descInputRef}
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={saveDesc}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveDesc();
                if (e.key === "Escape") setEditingDesc(false);
              }}
              placeholder="添加描述..."
              className="mt-1 max-w-2xl text-sm h-auto py-0.5 px-1"
            />
          ) : (
            <p
              className={`mt-1 max-w-2xl truncate text-sm text-muted-foreground transition-colors ${canEdit ? "group cursor-pointer hover:text-foreground/70" : ""}`}
              onClick={canEdit ? startEditDesc : undefined}
              title={canEdit ? "点击编辑描述" : undefined}
            >
              {workflow.description || (canEdit ? "添加描述..." : "暂无描述")}
              {canEdit && <Pencil className="inline-block ml-1 h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
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
          readOnly={!canEdit}
          onChange={canEdit ? (def) => {
            setDraft(def);
            setDirty(true);
          } : undefined}
          onSave={canEdit ? handleSave : undefined}
          onRun={canEdit ? handleRun : undefined}
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
