"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select } from "@tide/ui";
import {
  useProjectMembers,
  apiClient,
  type WorkflowNode,
  type WorkflowNodeType,
} from "@tide/core";
import { STAGE_CATEGORY_OPTIONS } from "./node-tones";

const TYPE_LABEL: Record<WorkflowNodeType, string> = {
  start: "起始",
  end: "终止",
  cancel: "取消",
  error: "错误",
  close: "关闭",
  agent: "Agent",
  approval: "审批",
  condition: "条件",
  parallel: "并行分发",
  parallel_join: "并行汇合",
  delay: "延时",
  stage: "阶段",
  git_merge: "Git合并",
};

const TYPE_GLYPH: Record<WorkflowNodeType, string> = {
  start: "▶",
  end: "■",
  cancel: "⊘",
  error: "✕",
  close: "○",
  agent: "🤖",
  approval: "🛡",
  condition: "◆",
  parallel: "＋",
  parallel_join: "−",
  delay: "⏱",
  stage: "✦",
  git_merge: "🔀",
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
  /** 当前工作流编辑上下文的项目 ID，供审批人下拉获取项目成员使用 */
  projectId?: string;
}

export function PropertyPanel({
  node,
  onUpdate,
  onDelete,
  readOnly,
  projectId,
}: PropertyPanelProps) {
  const { data: membersData } = useProjectMembers(projectId);
  const members = membersData?.members ?? [];

  // 专家团列表
  interface ExpertTeamOption {
    id: string;
    name: string;
    description?: string;
    agent_id: string;
    skill_slugs: string[];
    role_prompt?: string;
    enabled: number;
  }
  const [expertTeams, setExpertTeams] = useState<ExpertTeamOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ workspace_id: "default" });
    if (projectId) params.set("project_id", projectId);
    apiClient
      .get<ExpertTeamOption[]>(`/api/expert-teams?${params.toString()}`)
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          setExpertTeams(data.filter((t) => t.enabled === 1));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

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

          {t === "agent" && (() => {
            const selectedExpertTeamId: string | undefined = data.expert_team_id;
            const selectedExpertTeam = selectedExpertTeamId
              ? expertTeams.find((et) => et.id === selectedExpertTeamId)
              : undefined;

            return (
              <>
                {/* 专家团选择器 */}
                <FormGroup label="专家团">
                  <select
                    value={selectedExpertTeamId ?? ""}
                    disabled={readOnly}
                    onChange={(e) => {
                      const teamId = e.target.value;
                      if (!teamId) {
                        // 清除专家团：仅保留 prompt 和非 agent 字段
                        const { expert_team_id: _a, agent_id: _b, agentId: _c, skills: _d, model: _e, ...rest } = data;
                        onUpdate(node.id, rest);
                        return;
                      }
                      // 选择专家团：设置 expert_team_id，运行时由后端展开
                      update({ expert_team_id: teamId });
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">— 请选择专家团 —</option>
                    {expertTeams.map((et) => (
                      <option key={et.id} value={et.id}>
                        {et.name} ({et.agent_id} · {et.skill_slugs.length} 技能)
                      </option>
                    ))}
                  </select>
                  {!selectedExpertTeamId && (
                    <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                      请选择一个专家团，Agent 节点的模型、技能和角色提示词由专家团统一配置
                    </div>
                  )}
                </FormGroup>

                {/* 专家团详情预览（只读） */}
                {selectedExpertTeam && (
                  <FormGroup label="专家团配置（只读）">
                    <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-muted-foreground">名称</span>
                        <span className="text-[11px] font-medium text-foreground">{selectedExpertTeam.name}</span>
                      </div>
                      {selectedExpertTeam.description && (
                        <div className="text-[10px] leading-relaxed text-muted-foreground">
                          {selectedExpertTeam.description}
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-muted-foreground">Agent</span>
                        <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                          {selectedExpertTeam.agent_id}
                        </span>
                      </div>
                      {selectedExpertTeam.skill_slugs.length > 0 && (
                        <div>
                          <span className="text-[10px] font-medium text-muted-foreground">技能</span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {selectedExpertTeam.skill_slugs.map((slug) => (
                              <span
                                key={slug}
                                className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[10px] text-foreground"
                              >
                                {slug}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedExpertTeam.role_prompt && (
                        <div>
                          <span className="text-[10px] font-medium text-muted-foreground">角色提示词</span>
                          <pre className="mt-1 max-h-[80px] overflow-y-auto whitespace-pre-wrap rounded bg-background/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-foreground/80">
                            {selectedExpertTeam.role_prompt}
                          </pre>
                        </div>
                      )}
                      <div className="border-t border-primary/10 pt-1.5 text-[9px] text-muted-foreground">
                        运行时由后端自动展开为完整配置
                      </div>
                    </div>
                  </FormGroup>
                )}

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
                <FormGroup label="工作目录 (cwd)">
                  <Input
                    value={String(data.cwd ?? "")}
                    disabled={readOnly}
                    onChange={(e) => update({ cwd: e.target.value })}
                    placeholder="留空则使用项目根路径"
                    className="rounded-lg font-mono text-xs"
                  />
                </FormGroup>
                <FormGroup label="高级选项">
                  <label
                    className={`flex items-start gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5 transition-colors ${
                      readOnly
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 accent-primary"
                      checked={data.useWorktree !== false}
                      disabled={readOnly}
                      onChange={(e) =>
                        update({ useWorktree: e.target.checked })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-foreground">
                        启用工作区隔离
                      </div>
                      <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        Agent 将在独立的 Git Worktree 中执行，避免多工作项并行冲突
                      </div>
                    </div>
                  </label>
                </FormGroup>
                <label
                    className={`flex items-start gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5 transition-colors ${
                      readOnly
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 accent-primary"
                      checked={data.routingTrigger ?? true}
                      disabled={readOnly}
                      onChange={(e) =>
                        update({ routingTrigger: e.target.checked })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-foreground">
                        启用智能路由
                      </div>
                      <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        关闭后该节点不执行路由决策，适用于方案生成等前置 Agent 节点
                      </div>
                    </div>
                  </label>
              </>
            );
          })()}

          {t === "approval" && (
            <FormGroup label="审批人">
              {projectId && members.length > 0 ? (
                <ApproverPicker
                  members={members}
                  value={Array.isArray(data.approvers) ? data.approvers : []}
                  disabled={readOnly}
                  onChange={(next) => update({ approvers: next })}
                />
              ) : (
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
              )}
              {!projectId && (
                <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  项目上下文未提供，请以逗号分隔手动输入审批人
                </div>
              )}
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

          {t === "git_merge" && (
            <>
              <FormGroup label="源分支">
                <Input
                  value={String(data.sourceBranch ?? "")}
                  disabled={readOnly}
                  onChange={(e) => update({ sourceBranch: e.target.value })}
                  placeholder="留空则自动使用工作项分支"
                  className="rounded-lg font-mono text-xs"
                />
              </FormGroup>
              <FormGroup label="目标分支">
                <Input
                  value={String(data.targetBranch ?? "")}
                  disabled={readOnly}
                  onChange={(e) => update({ targetBranch: e.target.value })}
                  placeholder="留空则自动使用工作项分支"
                  className="rounded-lg font-mono text-xs"
                />
              </FormGroup>
              <FormGroup label="合并策略">
                <select
                  value={String(data.mergeStrategy ?? "merge")}
                  disabled={readOnly}
                  onChange={(e) => update({ mergeStrategy: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
                >
                  <option value="merge">Merge (保留提交历史)</option>
                  <option value="squash">Squash (压缩为单次提交)</option>
                  <option value="rebase">Rebase (变基)</option>
                </select>
              </FormGroup>
              <FormGroup label="冲突处理">
                <select
                  value={String(data.onConflict ?? "fail")}
                  disabled={readOnly}
                  onChange={(e) => update({ onConflict: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
                >
                  <option value="fail">失败并停止</option>
                  <option value="manual">等待手动处理</option>
                </select>
              </FormGroup>
              <FormGroup label="高级选项">
                <label className={`flex items-start gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5 transition-colors ${readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40"}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                    checked={data.deleteSource === true}
                    disabled={readOnly}
                    onChange={(e) => update({ deleteSource: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-foreground">合并后删除源分支</div>
                  </div>
                </label>
                <label className={`mt-2 flex items-start gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5 transition-colors ${readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40"}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                    checked={data.autoPush === true}
                    disabled={readOnly}
                    onChange={(e) => update({ autoPush: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-foreground">合并后自动推送</div>
                    <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                      合并成功后自动 push 到远程仓库（需在项目设置中配置仓库地址）
                    </div>
                  </div>
                </label>
              </FormGroup>
            </>
          )}

          {(t === "parallel" || t === "parallel_join") && (
            <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              {t === "parallel" ? "FORK" : "JOIN"} 节点仅控制流程结构，
              通过连线决定分支行为。
            </div>
          )}

          {(t === "start" || t === "end" || t === "cancel" || t === "error" || t === "close") && (
            <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              {t === "start" ? "START 节点为工作流入口。" : `${TYPE_LABEL[t]} 节点为工作流终态出口。`}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {!readOnly && onDelete && t !== "start" && t !== "end" && t !== "cancel" && t !== "error" && t !== "close" && (
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

interface ApproverPickerProps {
  members: { id: string; username: string; display_name: string | null }[];
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

function ApproverPicker({
  members,
  value,
  disabled,
  onChange,
}: ApproverPickerProps) {
  const selected = new Set(value);
  const toggle = (name: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(Array.from(next));
  };
  return (
    <div className="space-y-2">
      <div className="max-h-44 overflow-y-auto rounded-lg border border-input bg-background p-1">
        {members.length === 0 ? (
          <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            项目暂无成员
          </div>
        ) : (
          members.map((m) => {
            const name = m.display_name || m.username;
            const checked = selected.has(name);
            return (
              <label
                key={m.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  checked
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(name)}
                />
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary">
                  {name.slice(0, 1)}
                </span>
                <span className="flex-1 truncate">{name}</span>
              </label>
            );
          })
        )}
      </div>
      {value.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          已选 {value.length} 人：{value.join("、")}
        </div>
      )}
    </div>
  );
}
