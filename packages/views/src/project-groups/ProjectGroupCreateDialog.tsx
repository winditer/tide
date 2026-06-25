"use client";

import { useMemo, useState } from "react";
import { Button, Input } from "@tide/ui";
import {
  useCreateProjectGroup,
  type CreateProjectGroupInput,
  type ProjectInfo,
} from "@tide/core";

export interface ProjectGroupCreateDialogProps {
  /** 候选项目（来自 ``useProjects``）。 */
  projects: ProjectInfo[];
  workspaceId?: string;
  onClose: () => void;
  onSuccess?: (groupId: string) => void;
}

/**
 * 新建项目组对话框：填写名称/描述，并从已有项目列表中多选成员。
 * 选择顺序敏感 —— 第一个被选择的项目将被后端标记为 ``primary``。
 */
export function ProjectGroupCreateDialog({
  projects,
  workspaceId,
  onClose,
  onSuccess,
}: ProjectGroupCreateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateProjectGroup();

  const filteredProjects = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.cwd.toLowerCase().includes(kw),
    );
  }, [projects, search]);

  const toggleProject = (projectId: string) => {
    setSelected((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId],
    );
  };

  const handleSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写项目组名称");
      return;
    }

    try {
      const input: CreateProjectGroupInput = {
        name: trimmedName,
        description: description.trim() || undefined,
        workspace_id: workspaceId,
        project_ids: selected,
      };
      const group = await createMutation.mutateAsync(input);
      onSuccess?.(group.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border/50 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            NEW · GROUP
          </span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-sm text-muted-foreground transition-smooth hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">新建项目组</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              将多个仓库聚合到一个组中，便于跨仓库工作项编排
            </p>
          </div>

          <Field label="组名称" required>
            <Input
              autoFocus
              placeholder="例如：电商前后端"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field label="描述（可选）">
            <textarea
              placeholder="描述这个项目组的用途、范围等"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                选择成员项目
                <span className="ml-2 text-xs text-muted-foreground">
                  已选 {selected.length} 个
                  {selected.length > 0 ? "（首个为 primary）" : ""}
                </span>
              </span>
              <Input
                placeholder="搜索项目…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-44 rounded-md border-border/50 text-xs"
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60 bg-muted/30">
              {filteredProjects.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  没有可选的项目
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {filteredProjects.map((p) => {
                    const isSel = selected.includes(p.id);
                    const order = isSel
                      ? selected.indexOf(p.id) + 1
                      : 0;
                    return (
                      <li
                        key={p.id}
                        onClick={() => toggleProject(p.id)}
                        className={
                          "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors " +
                          (isSel
                            ? "bg-primary/5 hover:bg-primary/10"
                            : "hover:bg-muted/60")
                        }
                      >
                        <span
                          className={
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-mono " +
                            (isSel
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground")
                          }
                        >
                          {isSel ? order : ""}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {p.name}
                            </span>
                            {isSel && order === 1 && (
                              <span className="rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                                primary
                              </span>
                            )}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {p.cwd}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              ✕ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border/50 bg-muted/20 px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={createMutation.isPending}
            onClick={handleSubmit}
          >
            {createMutation.isPending ? "保存中…" : "创建项目组"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
