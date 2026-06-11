"use client";

import { Button, Input, Select } from "@tide/ui";
import type { WorkflowNode, WorkflowNodeType } from "@tide/core";
import { STAGE_CATEGORY_OPTIONS } from "./node-tones";

const TYPE_LABEL: Record<WorkflowNodeType, string> = {
  start: "起始",
  end: "终止",
  agent: "Agent",
  approval: "审批",
  condition: "条件",
  parallel: "并行分发",
  parallel_join: "并行汇合",
  delay: "延时",
  stage: "阶段",
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
  stage: "✦",
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

const AGENT_OPTIONS = [
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude" },
  { label: "Qoder", value: "qoder" },
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
      <div className="flex h-full w-[300px] flex-col border-l border-border/50 bg-card">
        <Header type={null} />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            未选中节点
          </div>
          <div className="text-xs text-muted-foreground">
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
    <div className="flex h-full w-[300px] flex-col border-l border-border/50 bg-card">
      <Header type={t} />

      {/* Meta */}
      <div className="border-b border-border/50 px-4 py-3">
        <Field label="ID" mono value={node.id} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field
            label="X"
            mono
            value={String(Math.round(node.position.x))}
          />
          <Field
            label="Y"
            mono
            value={String(Math.round(node.position.y))}
          />
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 divide-y divide-border/50">
        <div className="pb-3">
          <FormGroup label="名称">
            <Input
              value={String(data.label ?? "")}
              disabled={readOnly}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="节点名称"
              className="rounded-lg"
            />
          </FormGroup>

          {t === "agent" && (
            <>
              <FormGroup label="模型">
                <Input
                  value={String(data.model ?? "")}
                  disabled={readOnly}
                  onChange={(e) => update({ model: e.target.value })}
                  placeholder="留空使用默认模型"
                  className="rounded-lg"
                />
              </FormGroup>
              <FormGroup label="Agent">
                <Select
                  options={AGENT_OPTIONS}
                  value={String(data.agent_id ?? "codex")}
                  disabled={readOnly}
                  onChange={(e) => update({ agent_id: e.target.value })}
                />
              </FormGroup>
              <FormGroup label="Prompt">
                <textarea
                  disabled={readOnly}
                  className="flex min-h-[120px] w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  value={String(data.prompt ?? "")}
                  onChange={(e) => update({ prompt: e.target.value })}
                  placeholder="如留空则默认使用 prev_output"
                />
                <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  可用变量：<span className="text-emerald-600">{"{prev_output}"}</span> 上一节点输出 · <span className="text-emerald-600">{"{item.title}"}</span> 工作项标题 · <span className="text-emerald-600">{"{item.description}"}</span> 描述
                </div>
              </FormGroup>
            </>
          )}

          {t === "approval" && (
            <FormGroup label="审批人（逗号分隔）">
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
                className="rounded-lg"
              />
            </FormGroup>
          )}

          {t === "condition" && (
            <>
              <FormGroup label="字段">
                <Input
                  value={String(data.field ?? "")}
                  disabled={readOnly}
                  onChange={(e) => update({ field: e.target.value })}
                  placeholder="如：context.node_2.output"
                  className="rounded-lg font-mono text-xs"
                />
              </FormGroup>
              <FormGroup label="操作符">
                <Select
                  options={OPERATOR_OPTIONS}
                  value={String(data.operator ?? "eq")}
                  disabled={readOnly}
                  onChange={(e) => update({ operator: e.target.value })}
                />
              </FormGroup>
              <FormGroup label="比较值">
                <Input
                  value={String(data.value ?? "")}
                  disabled={readOnly}
                  onChange={(e) => update({ value: e.target.value })}
                  placeholder="比较值"
                  className="rounded-lg"
                />
              </FormGroup>
            </>
          )}

          {t === "delay" && (
            <FormGroup label="延迟秒数">
              <Input
                type="number"
                min={0}
                value={String(data.seconds ?? 0)}
                disabled={readOnly}
                onChange={(e) =>
                  update({ seconds: Number(e.target.value) || 0 })
                }
                className="rounded-lg font-mono"
              />
            </FormGroup>
          )}

          {t === "stage" && (
            <>
              <FormGroup label="类别">
                <Select
                  options={STAGE_CATEGORY_OPTIONS}
                  value={String(data.category ?? "custom")}
                  disabled={readOnly}
                  onChange={(e) => update({ category: e.target.value })}
                />
              </FormGroup>
              <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                STAGE 节点表示工作项阶段，在看板中作为纵列出现。
              </div>
            </>
          )}

          {(t === "parallel" || t === "parallel_join") && (
            <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              {t === "parallel" ? "FORK" : "JOIN"} 节点仅控制流程结构，
              通过连线决定分支行为。
            </div>
          )}

          {(t === "start" || t === "end") && (
            <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              {t === "start" ? "START" : "END"} 节点为工作流入口/出口。
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {!readOnly && onDelete && t !== "start" && (
        <div className="border-t border-border/50 bg-muted/30 px-4 py-3">
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
    <div className="border-b border-border/50 px-4 py-3">
      <div className="text-[10px] font-medium text-muted-foreground">
        属性面板
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span>节点属性</span>
        {type && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-[1px] text-[10px] font-medium">
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
      <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">
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
      <div className="text-[9px] font-medium text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-foreground ${
          mono ? "font-mono text-[11px]" : "text-[12px]"
        }`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
