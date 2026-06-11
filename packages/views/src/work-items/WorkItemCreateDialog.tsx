"use client";

import { useState } from "react";
import { Button, Input, Select } from "@tide/ui";
import { useCreateWorkItem } from "@tide/core";

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
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateWorkItem();

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
      });
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg border-2 border-zinc-900 bg-white shadow-[12px_12px_0_0_rgba(24,24,27,0.92)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-5 py-3 text-white">
          <span className="font-mono text-[11px] tracking-[0.3em]">
            NEW · WORK ITEM
          </span>
          <button
            onClick={onClose}
            className="font-mono text-sm text-zinc-300 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="space-y-5 p-6">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-zinc-900">
              新建工作项
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              在当前项目中创建一个新的工作项
            </p>
          </div>

          <Field label="标题" required>
            <Input
              autoFocus
              placeholder="输入工作项标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border-2 border-zinc-900 text-sm"
            />
          </Field>

          <Field label="描述">
            <textarea
              placeholder="可选的详细描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border-2 border-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="优先级">
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="border-2 border-zinc-900"
                options={PRIORITY_OPTIONS}
              />
            </Field>

            <Field label="负责人">
              <Input
                placeholder="可选"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="border-2 border-zinc-900 text-sm"
              />
            </Field>
          </div>

          <Field label="标签（逗号分隔）">
            <Input
              placeholder="bug, feature, urgent"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="border-2 border-zinc-900 font-mono text-sm"
            />
          </Field>

          {error && (
            <div className="border border-rose-500 bg-rose-50 px-3 py-2 font-mono text-xs text-rose-700">
              ✕ {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
            <Button
              variant="outline"
              className="border-2 border-zinc-900"
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              disabled={createMutation.isPending}
              className="border-2 border-zinc-900 bg-emerald-600 text-white shadow-[3px_3px_0_0_rgba(24,24,27,1)] hover:bg-emerald-700"
              onClick={handleSubmit}
            >
              {createMutation.isPending ? "创建中…" : "创建"}
            </Button>
          </div>
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
      <span className="mb-1.5 block font-mono text-[11px] tracking-widest text-zinc-600">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </span>
      {children}
    </label>
  );
}
