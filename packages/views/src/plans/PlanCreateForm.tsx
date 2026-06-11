"use client";

import { useId, useMemo, useState } from "react";
import { Button, Input, Select } from "@tide/ui";
import { useCreatePlan, useProjects } from "@tide/core";
import type { PlanTaskDef } from "@tide/core";

const AGENT_OPTIONS = [
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude" },
  { label: "Qoder CLI", value: "qoder" },
];

const MODEL_PRESETS = [
  { label: "默认（不指定）", value: "" },
  { label: "o4-mini", value: "o4-mini" },
  { label: "gpt-5", value: "gpt-5" },
  { label: "claude-sonnet-4.5", value: "claude-sonnet-4.5" },
  { label: "claude-opus-4", value: "claude-opus-4" },
];

interface DraftRow {
  title: string;
  prompt: string;
  agent_id: string;
  depends_on: string; // comma-separated indices
  phase: string;
}

const emptyRow = (): DraftRow => ({
  title: "",
  prompt: "",
  agent_id: "codex",
  depends_on: "",
  phase: "0",
});

interface PlanCreateFormProps {
  onSuccess?: (planId: string) => void;
}

export function PlanCreateForm({ onSuccess }: PlanCreateFormProps) {
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [model, setModel] = useState("");
  const [modelPreset, setModelPreset] = useState("");
  const [cwd, setCwd] = useState("");
  const [maxParallel, setMaxParallel] = useState("3");
  const create = useCreatePlan();
  const cwdListId = useId();

  const { data: projectsData } = useProjects();
  const projectOptions = useMemo(
    () => projectsData?.projects ?? [],
    [projectsData]
  );

  const updateRow = (idx: number, patch: Partial<DraftRow>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    );
  };
  const removeRow = (idx: number) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const buildTasks = (): PlanTaskDef[] => {
    return rows
      .filter((r) => r.title.trim() && r.prompt.trim())
      .map<PlanTaskDef>((r) => ({
        title: r.title.trim(),
        prompt: r.prompt.trim(),
        agent_id: r.agent_id || "codex",
        phase: Number(r.phase) || 0,
        depends_on: r.depends_on
          .split(/[ ,]+/)
          .filter((s) => s.length > 0)
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n) && n >= 0),
      }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tasks = buildTasks();
    if (tasks.length === 0) return;
    try {
      const plan = await create.mutateAsync({
        definition: { tasks, max_parallel: Number(maxParallel) || 3 },
        cwd: cwd.trim() || undefined,
        model: model.trim() || undefined,
      });
      onSuccess?.(plan.id);
    } catch {
      // surfaced via mutation state
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Global params */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <Label>项目目录</Label>
          <Input
            list={cwdListId}
            placeholder="选择或输入工作目录…"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            className="rounded-lg"
          />
          <datalist id={cwdListId}>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.cwd}>
                {p.name}
              </option>
            ))}
          </datalist>
          {projectOptions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              {projectOptions.slice(0, 4).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setCwd(p.cwd)}
                  className={`rounded-md border px-1.5 py-0.5 transition-colors ${
                    cwd === p.cwd
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-foreground"
                  }`}
                  title={p.cwd}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <Label>模型</Label>
          <div className="space-y-1">
            <Select
              options={MODEL_PRESETS}
              value={modelPreset}
              onChange={(e) => {
                const v = e.target.value;
                setModelPreset(v);
                setModel(v);
              }}
            />
            <Input
              placeholder="或自定义，如 o4-mini"
              value={model}
              className="rounded-lg"
              onChange={(e) => {
                setModel(e.target.value);
                setModelPreset("");
              }}
            />
          </div>
        </div>
        <div>
          <Label>最大并发</Label>
          <Input
            type="number"
            min={1}
            value={maxParallel}
            className="rounded-lg"
            onChange={(e) => setMaxParallel(e.target.value)}
          />
        </div>
      </div>

      {/* Task rows */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="!mb-0">任务 · {rows.length}</Label>
          <button
            type="button"
            onClick={addRow}
            className="text-xs text-muted-foreground hover:text-foreground transition-smooth"
          >
            + 添加任务
          </button>
        </div>

        {rows.map((row, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-border/50 bg-card shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-3 py-1.5 rounded-t-lg">
              <span className="text-[10px] font-medium text-muted-foreground">
                #{String(idx).padStart(2, "0")}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  className="text-[10px] text-destructive hover:underline"
                >
                  ✕ 删除
                </button>
              )}
            </div>
            <div className="space-y-2 p-3">
              <Input
                placeholder="标题（短描述）"
                className="rounded-lg"
                value={row.title}
                onChange={(e) => updateRow(idx, { title: e.target.value })}
              />
              <textarea
                className="flex min-h-[64px] w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-[12px] ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Prompt（任务指令）"
                value={row.prompt}
                onChange={(e) => updateRow(idx, { prompt: e.target.value })}
              />
              <div className="grid grid-cols-3 gap-2">
                <Select
                  options={AGENT_OPTIONS}
                  value={row.agent_id}
                  onChange={(e) =>
                    updateRow(idx, { agent_id: e.target.value })
                  }
                />
                <Input
                  placeholder="Phase (0)"
                  className="rounded-lg"
                  value={row.phase}
                  onChange={(e) => updateRow(idx, { phase: e.target.value })}
                />
                <Input
                  placeholder="Depends on (0,1)"
                  className="rounded-lg"
                  value={row.depends_on}
                  onChange={(e) =>
                    updateRow(idx, { depends_on: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "创建中…" : "▶ 创建 Plan"}
        </Button>
      </div>

      {create.isError && (
        <p className="text-xs text-destructive">
          创建失败：{String(create.error)}
        </p>
      )}
    </form>
  );
}

function Label({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-1.5 text-xs font-medium text-muted-foreground ${className}`}
    >
      {children}
    </div>
  );
}
