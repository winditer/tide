"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  Select,
  type SelectOptionGroup,
} from "@tide/ui";
import {
  useCreatePlan,
  useProjects,
  useProjectGroups,
  useProjectGroup,
  useAgents,
} from "@tide/core";
import type { PlanTaskDef } from "@tide/core";

// 无法从 /api/agents 取得时的兵底选项
const FALLBACK_AGENT_OPTIONS = [
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

const SCOPE_PROJECT_PREFIX = "project:";
const SCOPE_GROUP_PREFIX = "group:";

interface DraftRow {
  title: string;
  prompt: string;
  agent_id: string;
  depends_on: string; // comma-separated indices
  phase: string;
  /** 子任务级 cwd 覆盖（绝对路径，可选） */
  cwd: string;
}

const emptyRow = (): DraftRow => ({
  title: "",
  prompt: "",
  agent_id: "codex",
  depends_on: "",
  phase: "0",
  cwd: "",
});

interface PlanCreateFormProps {
  onSuccess?: (planId: string) => void;
  /**
   * 默认归属，与列表页/工作项创建对话框统一编码：
   * - "project:<id>" → 默认选中具体项目
   * - "group:<id>"   → 默认选中具体项目组
   */
  initialScopeValue?: string;
}

export function PlanCreateForm({
  onSuccess,
  initialScopeValue,
}: PlanCreateFormProps) {
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [model, setModel] = useState("");
  const [modelPreset, setModelPreset] = useState("");
  const [maxParallel, setMaxParallel] = useState("3");
  /**
   * 工作区归属：
   * - "project:<id>" → 单仓库 Plan，cwd = 该项目 cwd
   * - "group:<id>"   → 项目组工作区，group_id=<id>，默认 cwd 由后端解析为 primary
   */
  const [scopeValue, setScopeValue] = useState<string>(
    initialScopeValue ?? "",
  );
  const create = useCreatePlan();

  const { data: projectsData } = useProjects();
  const { data: groupsData } = useProjectGroups();
  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);
  const groups = useMemo(() => groupsData?.groups ?? [], [groupsData]);

  const selectedProjectId = scopeValue.startsWith(SCOPE_PROJECT_PREFIX)
    ? scopeValue.slice(SCOPE_PROJECT_PREFIX.length)
    : undefined;
  const selectedGroupId = scopeValue.startsWith(SCOPE_GROUP_PREFIX)
    ? scopeValue.slice(SCOPE_GROUP_PREFIX.length)
    : undefined;

  const { data: groupDetail } = useProjectGroup(selectedGroupId);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  // 动态 Agent 列表（已过滤禁用项，含本地 + 远程）
  const { data: agentsData } = useAgents({ projectId: selectedProjectId, scopeFilter: true });
  const agentOptions = useMemo(() => {
    const list = agentsData?.agents ?? [];
    if (list.length === 0) return FALLBACK_AGENT_OPTIONS;
    return list.map((a) => ({ label: a.name, value: a.id }));
  }, [agentsData]);

  const groupPrimary = useMemo(() => {
    if (!groupDetail) return undefined;
    return (
      groupDetail.members.find((m) => m.role === "primary") ??
      groupDetail.members[0]
    );
  }, [groupDetail]);

  const scopeGroupsOptions = useMemo<SelectOptionGroup[]>(() => {
    const out: SelectOptionGroup[] = [];
    if (projects.length > 0) {
      out.push({
        label: "项目",
        options: projects.map((p) => ({
          value: `${SCOPE_PROJECT_PREFIX}${p.id}`,
          label: p.name === p.cwd ? p.cwd : `${p.name}  ·  ${p.cwd}`,
        })),
      });
    }
    if (groups.length > 0) {
      out.push({
        label: "项目组",
        options: groups.map((g) => ({
          value: `${SCOPE_GROUP_PREFIX}${g.id}`,
          label: `${g.name} (${g.member_count})`,
        })),
      });
    }
    return out;
  }, [projects, groups]);

  const scopeFlatOptions = useMemo(
    () => [{ value: "", label: "请选择项目或项目组…" }],
    [],
  );

  const updateRow = (idx: number, patch: Partial<DraftRow>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };
  const removeRow = (idx: number) =>
    setRows((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== idx),
    );
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const buildTasks = (): PlanTaskDef[] => {
    return rows
      .filter((r) => r.title.trim() && r.prompt.trim())
      .map<PlanTaskDef>((r) => {
        const cwdOverride = r.cwd.trim();
        return {
          title: r.title.trim(),
          prompt: r.prompt.trim(),
          agent_id: r.agent_id || "codex",
          phase: Number(r.phase) || 0,
          depends_on: r.depends_on
            .split(/[ ,]+/)
            .filter((s) => s.length > 0)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n) && n >= 0),
          ...(cwdOverride ? { cwd: cwdOverride } : {}),
        };
      });
  };

  // 项目组下子任务 cwd 候选：用于选择目标仓库
  const groupMemberCwds = useMemo(() => {
    if (!groupDetail) return [] as { value: string; label: string }[];
    return groupDetail.members
      .filter((m): m is typeof m & { cwd: string } => !!m.cwd)
      .map((m) => ({ value: m.cwd, label: `${m.name} (${m.role})` }));
  }, [groupDetail]);

  // 切换归属时清空已填的子任务 cwd 覆盖（避免跨项目残留）
  useEffect(() => {
    setRows((prev) => prev.map((r) => ({ ...r, cwd: "" })));
  }, [scopeValue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tasks = buildTasks();
    if (tasks.length === 0) return;
    if (!selectedProjectId && !selectedGroupId) return;

    const params: Parameters<typeof create.mutateAsync>[0] = {
      definition: { tasks, max_parallel: Number(maxParallel) || 3 },
      model: model.trim() || undefined,
    };

    if (selectedGroupId) {
      params.group_id = selectedGroupId;
      // cwd 不传：后端会自动取 group primary 的路径
    } else if (selectedProject) {
      params.cwd = selectedProject.cwd || undefined;
    }

    try {
      const plan = await create.mutateAsync(params);
      onSuccess?.(plan.id);
    } catch {
      // surfaced via mutation state
    }
  };

  const submitDisabled =
    create.isPending ||
    (!selectedProjectId && !selectedGroupId) ||
    (!!selectedGroupId && !groupPrimary);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Global params */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <Label>工作区</Label>
          <Select
            options={scopeFlatOptions}
            groups={scopeGroupsOptions}
            value={scopeValue}
            onChange={(e) => setScopeValue(e.target.value)}
            className="rounded-lg"
            aria-label="选择项目或项目组"
          />
          {selectedGroupId && groupDetail && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              项目组 ·{" "}
              <span className="font-mono text-foreground">
                {groupPrimary?.name ?? "—"}
              </span>{" "}
              将作为默认 cwd；子任务可在下方单独覆盖目标仓库。
            </p>
          )}
          {selectedProject && (
            <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">
              {selectedProject.cwd}
            </p>
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
                  options={agentOptions}
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
              {/* 项目组模式：子任务可单独覆盖目标仓库 */}
              {selectedGroupId && groupMemberCwds.length > 0 && (
                <div>
                  <Select
                    options={[
                      { value: "", label: "目标仓库（默认继承组 primary）" },
                      ...groupMemberCwds,
                    ]}
                    value={row.cwd}
                    onChange={(e) => updateRow(idx, { cwd: e.target.value })}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={submitDisabled}>
          {create.isPending ? "创建中…" : "▶ 创建 Plan"}
        </Button>
      </div>

      {selectedGroupId && !groupPrimary && (
        <p className="text-xs text-destructive">
          项目组成员为空，请先为该组添加项目。
        </p>
      )}

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
