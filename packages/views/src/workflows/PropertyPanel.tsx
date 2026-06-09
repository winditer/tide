"use client";

import { Button, Input, Select } from "@lark2codex/ui";
import type { WorkflowNode, WorkflowNodeType } from "@lark2codex/core";

const TYPE_LABEL: Record<WorkflowNodeType, string> = {
  start: "起始",
  end: "终止",
  agent: "Agent",
  approval: "审批",
  condition: "条件",
  parallel: "并行分发",
  parallel_join: "并行汇合",
  delay: "延时",
};

const TYPE_GLYPH: Record<WorkflowNodeType, string> = {
  start: "▶",
  end: "■",
  agent: "🤖",
  approval: "🛡",
  condition: "◆",
  parallel: "＋",
  parallel_join: "−",
  delay: "⏱",
};

const OPERATOR_OPTIONS = [
  { label: "等于 (==)", value: "eq" },
  { label: "不等于 (≠)", value: "ne" },
  { label: "大于 (>)", value: "gt" },
  { label: "小于 (<)", value: "lt" },
  { label: "大于等于 (≥)", value: "gte" },
  { label: "小于等于 (≤)", value: "lte" },
  { label: "包含 (⊃)", value: "contains" },
  { label: "不包含 (⊅)", value: "not_contains" },
];

interface PropertyPanelProps {
  node: WorkflowNode | null;
  onUpdate: (id: string, data: Record<string, any>) => void;
  onDelete?: (id: string) => void;
  readOnly?: boolean;
}

export function PropertyPanel({
  node,
  onUpdate,
  onDelete,
  readOnly,
}: PropertyPanelProps) {
  if (!node) {
    return (
      <div className="flex h-full w-[300px] flex-col border-l-2 border-zinc-900 bg-white">
        <Header type={null} />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-2 font-mono text-[10px] tracking-[0.25em] text-zinc-400">
            ◇ NO SELECTION
          </div>
          <div className="text-xs text-zinc-500">
            点击画布中的节点查看与编辑属性
          </div>
        </div>
      </div>
    );
  }

  const t = node.type as WorkflowNodeType;
  const data = node.data ?? {};

  const update = (patch: Record<string, any>) =>
    onUpdate(node.id, { ...data, ...patch });

  return (
    <div className="flex h-full w-[300px] flex-col border-l-2 border-zinc-900 bg-white">
      <Header type={t} />

      {/* Meta */}
      <div className="border-b border-dashed border-zinc-300 px-4 py-3">
        <Field label="ID" mono value={node.id} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field
            label="POS·X"
            mono
            value={String(Math.round(node.position.x))}
          />
          <Field
            label="POS·Y"
            mono
            value={String(Math.round(node.position.y))}
          />
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <FormGroup label="LABEL">
          <Input
            value={String(data.label ?? "")}
            disabled={readOnly}
            onChange={(e) => update({ label: e.target.value })}
            placeholder="节点名称"
          />
        </FormGroup>

        {t === "agent" && (
          <>
            <FormGroup label="MODEL">
              <Input
                value={String(data.model ?? "")}
                disabled={readOnly}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="如：gpt-4 / claude-3.5-sonnet"
              />
            </FormGroup>
            <FormGroup label="AGENT_ID">
              <Input
                value={String(data.agent_id ?? "")}
                disabled={readOnly}
                onChange={(e) => update({ agent_id: e.target.value })}
                placeholder="可选：Agent 标识"
              />
            </FormGroup>
            <FormGroup label="PROMPT">
              <textarea
                disabled={readOnly}
                className="flex min-h-[120px] w-full rounded-none border-2 border-zinc-900 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-900 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 disabled:opacity-50"
                value={String(data.prompt ?? "")}
                onChange={(e) => update({ prompt: e.target.value })}
                placeholder="发送给 Agent 的提示词…"
              />
            </FormGroup>
          </>
        )}

        {t === "approval" && (
          <FormGroup label="APPROVERS (COMMA-SEPARATED)">
            <Input
              value={
                Array.isArray(data.approvers) ? data.approvers.join(", ") : ""
              }
              disabled={readOnly}
              onChange={(e) =>
                update({
                  approvers: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="user1, user2"
            />
          </FormGroup>
        )}

        {t === "condition" && (
          <>
            <FormGroup label="FIELD">
              <Input
                value={String(data.field ?? "")}
                disabled={readOnly}
                onChange={(e) => update({ field: e.target.value })}
                placeholder="如：context.node_2.output"
                className="font-mono text-xs"
              />
            </FormGroup>
            <FormGroup label="OPERATOR">
              <Select
                options={OPERATOR_OPTIONS}
                value={String(data.operator ?? "eq")}
                disabled={readOnly}
                onChange={(e) => update({ operator: e.target.value })}
              />
            </FormGroup>
            <FormGroup label="VALUE">
              <Input
                value={String(data.value ?? "")}
                disabled={readOnly}
                onChange={(e) => update({ value: e.target.value })}
                placeholder="比较值"
              />
            </FormGroup>
          </>
        )}

        {t === "delay" && (
          <FormGroup label="SECONDS">
            <Input
              type="number"
              min={0}
              value={String(data.seconds ?? 0)}
              disabled={readOnly}
              onChange={(e) =>
                update({ seconds: Number(e.target.value) || 0 })
              }
              className="font-mono"
            />
          </FormGroup>
        )}

        {(t === "parallel" || t === "parallel_join") && (
          <div className="rounded-none border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[10px] leading-relaxed text-zinc-500">
            ◇ {t === "parallel" ? "FORK" : "JOIN"} 节点仅控制流程结构，
            通过连线决定分支行为。
          </div>
        )}

        {(t === "start" || t === "end") && (
          <div className="rounded-none border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[10px] leading-relaxed text-zinc-500">
            ◇ {t === "start" ? "START" : "END"} 节点为工作流入口/出口。
          </div>
        )}
      </div>

      {/* Footer */}
      {!readOnly && onDelete && t !== "start" && (
        <div className="border-t-2 border-zinc-900 bg-zinc-50 px-4 py-3">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => {
              if (confirm("确定删除该节点？")) onDelete(node.id);
            }}
          >
            ✕ 删除节点
          </Button>
        </div>
      )}
    </div>
  );
}

function Header({ type }: { type: WorkflowNodeType | null }) {
  return (
    <div className="border-b-2 border-zinc-900 bg-zinc-950 px-4 py-3 text-white">
      <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
        INSPECT
      </div>
      <div className="mt-0.5 flex items-center gap-2 font-mono text-[13px] font-bold tracking-[0.2em]">
        <span>◴</span>
        <span>PROPERTY</span>
        {type && (
          <span className="ml-auto inline-flex items-center gap-1 border border-zinc-700 bg-zinc-900 px-1.5 py-[1px] text-[10px] tracking-widest">
            <span>{TYPE_GLYPH[type]}</span>
            <span>{TYPE_LABEL[type]}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function FormGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 font-mono text-[10px] tracking-[0.2em] text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[9px] tracking-[0.2em] text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-zinc-900 ${
          mono ? "font-mono text-[11px]" : "text-[12px]"
        }`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
