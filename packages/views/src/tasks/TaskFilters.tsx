"use client";

import { Button, Select, Input } from "@lark2codex/ui";
import { useAgents, useProjects, useSessions } from "@lark2codex/core";

export interface TaskFiltersValue {
  status?: string;
  agent_id?: string;
  project?: string;
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

function shortSession(id: string | null | undefined) {
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function projectName(cwd: string) {
  return cwd.replace(/\/+$/, "").split("/").pop() || cwd;
}

export function TaskFilters({ value, onChange, onReset }: TaskFiltersProps) {
  const { data: projectsData } = useProjects();
  const { data: agentsData } = useAgents();
  const { data: sessionsData } = useSessions({
    project: value.project || undefined,
    agent_id: value.agent_id || undefined,
    page_size: 200,
  });

  const projectOptions = [
    { label: "全部项目", value: "" },
    ...(projectsData?.projects ?? []).map((p) => ({
      label: `${p.name}${p.cwd && p.cwd !== p.name ? `  (${p.cwd})` : ""}`,
      value: p.cwd,
    })),
  ];

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

  const hasActive =
    !!value.status ||
    !!value.agent_id ||
    !!value.project ||
    !!value.session_id ||
    !!value.created_after ||
    !!value.created_before;

  return (
    <div className="mb-4 rounded-lg border bg-card/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label="项目" className="min-w-[150px] flex-1 basis-[160px] max-w-[240px]">
          <Select
            options={projectOptions}
            value={value.project ?? ""}
            onChange={(e) => update({ project: e.target.value || undefined })}
          />
        </FilterField>

        <FilterField label="会话" className="min-w-[150px] flex-1 basis-[160px] max-w-[240px]">
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

        <FilterField label="创建时间" className="flex-1 min-w-[220px] basis-[240px]">
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
          className="ml-auto flex-shrink-0 whitespace-nowrap"
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
