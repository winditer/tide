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
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          名称 *
        </label>
        <Input
          placeholder="如：代码评审流水线"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="rounded-lg"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          描述
        </label>
        <textarea
          className="flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="描述工作流的用途与触发条件…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        创建后将进入可视化编辑器，包含 START → END 起始模板。
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
        <p className="text-xs text-destructive">
          创建失败：{String(create.error)}
        </p>
      )}
    </form>
  );
}
