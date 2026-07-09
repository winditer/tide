"use client";

import { useMemo } from "react";
import { Button, Select, Input, type SelectOptionGroup } from "@tide/ui";
import { useAgents, useProjects, useProjectGroups, useSessions } from "@tide/core";

export interface TaskFiltersValue {
  status?: string;
  agent_id?: string;
  /** 项目 cwd（与 group_id 互斥） */
  project?: string;
  /** 项目组 id（与 project 互斥） */
  group_id?: string;
  session_id?: string;
  created_after?: string;
  created_before?: string;
}

interface TaskFiltersProps {
  value: TaskFiltersValue;
  onChange: (value: TaskFiltersValue) => void;
  onReset: () => void;
}

const STATUS_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "排队中", value: "queued" },
  { label: "运行中", value: "running" },
  { label: "待审批", value: "review" },
  { label: "已完成", value: "completed" },
  { label: "失败", value: "failed" },
  { label: "已停止", value: "stopped" },
];

const SCOPE_PROJECT_PREFIX = "project:";
const SCOPE_GROUP_PREFIX = "group:";

function shortSession(id: string | null | undefined) {
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function projectName(cwd: string) {
  return cwd.replace(/\/+$/, "").split("/").pop() || cwd;
}

export function TaskFilters({ value, onChange, onReset }: TaskFiltersProps) {
  const { data: projectsData } = useProjects();
  const { data: groupsData } = useProjectGroups();
  const { data: agentsData } = useAgents({ scopeFilter: true });
  const { data: sessionsData } = useSessions({
    project: value.project || undefined,
    group_id: value.group_id || undefined,
    agent_id: value.agent_id || undefined,
    page_size: 200,
  });

  const projects = projectsData?.projects ?? [];
  const groups = groupsData?.groups ?? [];

  // 统一项目/项目组选择器编码值
  const scopeValue = value.group_id
    ? `${SCOPE_GROUP_PREFIX}${value.group_id}`
    : value.project
      ? `${SCOPE_PROJECT_PREFIX}${value.project}`
      : "";

  const scopeFlatOptions = useMemo(
    () => [{ label: "全部", value: "" }],
    [],
  );
  const scopeGroups = useMemo<SelectOptionGroup[]>(() => {
    const out: SelectOptionGroup[] = [];
    if (projects.length > 0) {
      out.push({
        label: "项目",
        options: projects.map((p) => ({
          value: `${SCOPE_PROJECT_PREFIX}${p.cwd}`,
          label: `${p.name}${p.cwd && p.cwd !== p.name ? `  (${p.cwd})` : ""}`,
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

  const agentOptions = [
    { label: "全部 Agent", value: "" },
    ...(agentsData?.agents ?? []).map((a) => ({
      label: a.name || a.id,
      value: a.id,
    })),
  ];

  const sessionOptions = [
    { label: "全部会话", value: "" },
    ...(sessionsData?.sessions ?? [])
      .filter((s) => !!s.session_id)
      .map((s) => ({
        label: `${shortSession(s.session_id)}${s.cwd ? ` · ${projectName(s.cwd)}` : ""}${s.agent_id ? ` · ${s.agent_id}` : ""}`,
        value: s.session_id,
      })),
  ];

  const update = (patch: Partial<TaskFiltersValue>) => {
    onChange({ ...value, ...patch });
  };

  const handleScopeChange = (next: string) => {
    if (!next) {
      // 切换到“全部”时清除 project/group_id，并重置 session 过滤
      update({ project: undefined, group_id: undefined, session_id: undefined });
      return;
    }
    if (next.startsWith(SCOPE_PROJECT_PREFIX)) {
      const cwd = next.slice(SCOPE_PROJECT_PREFIX.length);
      update({
        project: cwd || undefined,
        group_id: undefined,
        // 切换归属后清空会话过滤，避免脏数据
        session_id: undefined,
      });
      return;
    }
    if (next.startsWith(SCOPE_GROUP_PREFIX)) {
      const gid = next.slice(SCOPE_GROUP_PREFIX.length);
      update({
        project: undefined,
        group_id: gid || undefined,
        session_id: undefined,
      });
    }
  };

  const hasActive =
    !!value.status ||
    !!value.agent_id ||
    !!value.project ||
    !!value.group_id ||
    !!value.session_id ||
    !!value.created_after ||
    !!value.created_before;

  return (
    <div className="mb-4 rounded-lg border bg-card/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField
          label="项目 / 项目组"
          className="min-w-[180px] flex-1 basis-[200px] max-w-[240px]"
        >
          <Select
            options={scopeFlatOptions}
            groups={scopeGroups}
            value={scopeValue}
            onChange={(e) => handleScopeChange(e.target.value)}
          />
        </FilterField>

        <FilterField label="会话" className="min-w-[150px] flex-1 basis-[160px] max-w-[180px]">
          <Select
            options={sessionOptions}
            value={value.session_id ?? ""}
            onChange={(e) => update({ session_id: e.target.value || undefined })}
          />
        </FilterField>

        <FilterField label="Agent" className="w-[120px] flex-shrink-0">
          <Select
            options={agentOptions}
            value={value.agent_id ?? ""}
            onChange={(e) => update({ agent_id: e.target.value || undefined })}
          />
        </FilterField>

        <FilterField label="状态" className="w-[110px] flex-shrink-0">
          <Select
            options={STATUS_OPTIONS}
            value={value.status ?? ""}
            onChange={(e) => update({ status: e.target.value || undefined })}
          />
        </FilterField>

        <FilterField label="创建时间" className="flex-1 min-w-[280px] basis-[280px]">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              className="min-w-0 flex-1"
              value={value.created_after?.slice(0, 10) ?? ""}
              onChange={(e) =>
                update({
                  created_after: e.target.value
                    ? `${e.target.value}T00:00:00`
                    : undefined,
                })
              }
            />
            <span className="text-muted-foreground">→</span>
            <Input
              type="date"
              className="min-w-0 flex-1"
              value={value.created_before?.slice(0, 10) ?? ""}
              onChange={(e) =>
                update({
                  created_before: e.target.value
                    ? `${e.target.value}T23:59:59`
                    : undefined,
                })
              }
            />
          </div>
        </FilterField>

        <Button
          variant="outline"
          size="sm"
          disabled={!hasActive}
          onClick={onReset}
          className="ml-auto shrink-0 whitespace-nowrap"
        >
          清除筛选
        </Button>
      </div>
    </div>
  );
}

function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
