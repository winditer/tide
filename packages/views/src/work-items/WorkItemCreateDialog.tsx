"use client";

import { useMemo, useState } from "react";
import { Button, Input, Select } from "@tide/ui";
import { useCreateWorkItem, useVersions, useProjectMembers } from "@tide/core";

interface WorkItemCreateDialogProps {
  projectId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const PRIORITY_OPTIONS = [
  { value: "0", label: "无优先级" },
  { value: "1", label: "低" },
  { value: "2", label: "中" },
  { value: "3", label: "高" },
  { value: "4", label: "紧急" },
];

export function WorkItemCreateDialog({
  projectId,
  onClose,
  onSuccess,
}: WorkItemCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("0");
  const [assignee, setAssignee] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [versionId, setVersionId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateWorkItem();
  const { data: versions = [] } = useVersions(projectId);
  const { data: membersData } = useProjectMembers(projectId);

  const assigneeOptions = useMemo(() => {
    const opts = [{ value: "", label: "未指定" }];
    for (const m of membersData?.members ?? []) {
      const name = m.display_name || m.username;
      opts.push({ value: name, label: name });
    }
    return opts;
  }, [membersData]);

  const versionOptions = useMemo(() => {
    const opts = [{ value: "", label: "不关联版本" }];
    for (const v of versions) {
      const suffix =
        v.status === "released"
          ? " · 已发布"
          : v.status === "archived"
            ? " · 已归档"
            : "";
      opts.push({ value: v.id, label: `${v.name}${suffix}` });
    }
    return opts;
  }, [versions]);

  const handleSubmit = async () => {
    setError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("标题不能为空");
      return;
    }

    try {
      await createMutation.mutateAsync({
        project_id: projectId,
        title: trimmedTitle,
        description: description.trim() || undefined,
        priority: Number(priority),
        assignee: assignee.trim() || undefined,
        tags: tagsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        version_id: versionId || null,
      });
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl animate-in zoom-in-95 fade-in-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              新建工作项
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              在当前项目中创建一个新的工作项
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="space-y-5 p-6">
          <Field label="标题" required>
            <Input
              autoFocus
              placeholder="输入工作项标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10 rounded-lg border-0 bg-muted/50 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
          </Field>

          <Field label="描述">
            <textarea
              placeholder="可选的详细描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="优先级">
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
                options={PRIORITY_OPTIONS}
              />
            </Field>

            <Field label="负责人">
              <Select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                options={assigneeOptions}
                className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
              />
            </Field>
          </div>

          <Field label="标签（逗号分隔）">
            <Input
              placeholder="bug, feature, urgent"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="h-10 rounded-lg border-0 bg-muted/50 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
          </Field>

          <Field label="版本（可选）">
            <Select
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              options={versionOptions}
              className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
            />
          </Field>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border/60 bg-muted/20 px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={createMutation.isPending}
            onClick={handleSubmit}
          >
            {createMutation.isPending ? "创建中…" : "创建工作项"}
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
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
