"use client";

import { useState } from "react";
import { Button, Input } from "@tide/ui";
import { useCreateWorkflow } from "@tide/core";
import type { WorkflowDefinition } from "@tide/core";

const STARTER_DEFINITION: WorkflowDefinition = {
  nodes: [
    {
      id: "start_1",
      type: "start",
      position: { x: 280, y: 60 },
      data: { label: "Start" },
    },
    {
      id: "end_1",
      type: "end",
      position: { x: 280, y: 280 },
      data: { label: "Done" },
    },
  ],
  edges: [
    {
      id: "e_start_1_end_1",
      source: "start_1",
      target: "end_1",
    },
  ],
};

interface WorkflowCreateFormProps {
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}

export function WorkflowCreateForm({
  onSuccess,
  onCancel,
}: WorkflowCreateFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useCreateWorkflow();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const wf = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        definition: STARTER_DEFINITION,
        enabled: true,
      });
      onSuccess?.(wf.id);
    } catch {
      // surfaced via mutation state
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block font-mono text-[10px] tracking-[0.2em] text-zinc-700">
          NAME *
        </label>
        <Input
          placeholder="如：代码评审流水线"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="mb-1.5 block font-mono text-[10px] tracking-[0.2em] text-zinc-700">
          DESCRIPTION
        </label>
        <textarea
          className="flex min-h-[80px] w-full rounded-none border-2 border-zinc-900 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          placeholder="描述工作流的用途与触发条件…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[10px] leading-relaxed tracking-wider text-zinc-600">
        ◇ 创建后将进入可视化编辑器，包含 START → END 起始模板。
      </div>

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button
          type="submit"
          disabled={create.isPending || !name.trim()}
        >
          {create.isPending ? "创建中…" : "+ 创建工作流"}
        </Button>
      </div>

      {create.isError && (
        <p className="font-mono text-xs text-rose-600">
          ✕ 创建失败：{String(create.error)}
        </p>
      )}
    </form>
  );
}
