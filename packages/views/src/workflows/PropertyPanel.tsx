"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select } from "@tide/ui";
import {
  useProjectMembers,
  getAgents,
  type AgentInfo,
  type AgentSkill,
  type WorkflowNode,
  type WorkflowNodeType,
} from "@tide/core";
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
  git_merge: "Git合并",
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

const LOCAL_AGENT_OPTIONS = [
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude" },
  { label: "Qoder", value: "qoder" },
];

function isRemoteAgentId(id: string | undefined | null): boolean {
  return typeof id === "string" && id.startsWith("a2a:");
}

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

  // 远程 Agent 列表：组件挂载时拉取一次，失败时降级为空数组仅显示本地 Agent。
  const [remoteAgents, setRemoteAgents] = useState<AgentInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    getAgents()
      .then((res) => {
        if (cancelled) return;
        const remotes = (res?.agents ?? []).filter(
          (a) => a.type === "remote" || isRemoteAgentId(a.id),
        );
        setRemoteAgents(remotes);
      })
      .catch(() => {
        // 降级：保持空列表，仅展示本地 Agent
        if (!cancelled) setRemoteAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
            const currentAgentId = String(data.agent_id ?? data.agentId ?? "codex");
            const isRemote = isRemoteAgentId(currentAgentId);
            const selectedRemote = isRemote
              ? remoteAgents.find((a) => a.id === currentAgentId)
              : undefined;
            return (
              <>
                {!isRemote && (
                  <FormGroup label="模型">
                    <Input
                      value={String(data.model ?? "")}
                      disabled={readOnly}
                      onChange={(e) => update({ model: e.target.value })}
                      placeholder="留空使用默认模型"
                      className="rounded-lg"
                    />
                  </FormGroup>
                )}
                <FormGroup label="Agent">
                  <AgentSelect
                    value={currentAgentId}
                    disabled={readOnly}
                    remoteAgents={remoteAgents}
                    onChange={(next) =>
                      update({
                        agent_id: next,
                        // 同步写入 camelCase 别名，保证与后端/其他调用点兼容
                        agentId: next,
                      })
                    }
                  />
                </FormGroup>
                {isRemote && (
                  <FormGroup label="Skills">
                    <RemoteAgentSkills agent={selectedRemote} />
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
                {!isRemote && (
                  <FormGroup label="工作目录 (cwd)">
                    <Input
                      value={String(data.cwd ?? "")}
                      disabled={readOnly}
                      onChange={(e) => update({ cwd: e.target.value })}
                      placeholder="留空则使用项目根路径"
                      className="rounded-lg font-mono text-xs"
                    />
                  </FormGroup>
                )}
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

interface ApproverPickerProps {
  members: { id: string; username: string; display_name: string | null }[];
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

interface AgentSelectProps {
  value: string;
  disabled?: boolean;
  remoteAgents: AgentInfo[];
  onChange: (next: string) => void;
}

/** Agent 选择器：分组展示本地 / 远程 Agent，远程项携带状态色点。 */
function AgentSelect({
  value,
  disabled,
  remoteAgents,
  onChange,
}: AgentSelectProps) {
  // 如果当前 value 是 a2a:* 但在远程列表中未找到（列表未加载完成或该 Agent 已下架），
  // 依然作为占位项加入，避免 native select 选中项丢失。
  const knownRemoteIds = new Set(remoteAgents.map((a) => a.id));
  const ghostRemote =
    isRemoteAgentId(value) && !knownRemoteIds.has(value) ? value : null;

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <optgroup label="本地 Agent">
        {LOCAL_AGENT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </optgroup>
      {(remoteAgents.length > 0 || ghostRemote) && (
        <optgroup label="远程 Agent">
          {remoteAgents.map((agent) => {
            const active = (agent.status ?? "").toLowerCase() === "active";
            // native <option> 不能渲染颜色节点，使用 ● 字符作为状态前缀
            const dot = active ? "\u{1F7E2}" : "\u26AA";
            const label = `${dot} ${agent.name || agent.id}`;
            return (
              <option key={agent.id} value={agent.id}>
                {label}
              </option>
            );
          })}
          {ghostRemote && (
            <option key={ghostRemote} value={ghostRemote}>
              {`\u26AA ${ghostRemote}`}
            </option>
          )}
        </optgroup>
      )}
    </select>
  );
}

/** 远程 Agent skills 只读展示区：帮助用户了解该 Agent 可以完成什么并编写 prompt。 */
function RemoteAgentSkills({ agent }: { agent: AgentInfo | undefined }) {
  if (!agent) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        未找到该远程 Agent。请确认其是否仍在注册表中且状态为 active。
      </div>
    );
  }
  const skills: AgentSkill[] = Array.isArray(agent.skills) ? agent.skills : [];
  if (skills.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        该 Agent 未声明 skills。可直接在 Prompt 中描述任务。
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
      {agent.description && (
        <div className="text-[10px] leading-relaxed text-muted-foreground">
          {agent.description}
        </div>
      )}
      <ul className="space-y-1.5">
        {skills.map((skill, idx) => {
          const name = skill.name || skill.id || `skill-${idx + 1}`;
          return (
            <li
              key={skill.id ?? `${name}-${idx}`}
              className="rounded-md bg-background/60 px-2 py-1.5"
            >
              <div className="text-[11px] font-medium text-foreground">
                {name}
              </div>
              {skill.description && (
                <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {skill.description}
                </div>
              )}
              {Array.isArray(skill.tags) && skill.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {skill.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded border border-border/50 bg-background px-1 py-[1px] text-[9px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
        提示：在 Prompt 中明确描述需要调用的能力，可提高远程 Agent 完成任务的准确率。
      </div>
    </div>
  );
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
