"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select, type SelectOptionGroup } from "@tide/ui";
import {
  useCreateWorkItem,
  useVersions,
  useProjectMembers,
  useProjects,
  useProjectGroups,
  useProjectGroup,
} from "@tide/core";
import { AIOptimizeButton } from "./AIOptimizeButton";

interface WorkItemCreateDialogProps {
  /**
   * 调用方传入的默认项目 id（项目组模式下可能被该组 primary 项目覆盖）。
   * 当 ``initialScopeValue`` 为 ``project:<id>`` 时与 id 应一致。
   */
  projectId: string;
  /**
   * 默认归属，与列表页筛选器同构。
   *
   * - ``"project:<id>"`` -> 默认选中具体项目
   * - ``"group:<id>"``   -> 默认选中具体项目组
   * - ``""`` / 缺省      -> 使用 ``projectId`` 作为单仓库默认
   */
  initialScopeValue?: string;
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

const SCOPE_PROJECT_PREFIX = "project:";
const SCOPE_GROUP_PREFIX = "group:";

/** 把传入的初始 scope 与 projectId 归一化为统一 selectValue。 */
function buildInitialScopeValue(
  initial: string | undefined,
  projectId: string,
): string {
  if (initial && initial.startsWith(SCOPE_GROUP_PREFIX)) return initial;
  if (initial && initial.startsWith(SCOPE_PROJECT_PREFIX)) return initial;
  if (projectId) return `${SCOPE_PROJECT_PREFIX}${projectId}`;
  return "";
}

export function WorkItemCreateDialog({
  projectId,
  initialScopeValue,
  onClose,
  onSuccess,
}: WorkItemCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("0");
  const [assignee, setAssignee] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [versionId, setVersionId] = useState("");
  /**
   * 归属选择：与列表页统一编码。
   * - ``"project:<id>"`` -> 单仓库（创建时 project_id=<id>，group_id=null）
   * - ``"group:<id>"``   -> 项目组（project_id=组 primary，group_id=<id>）
   */
  const [scopeValue, setScopeValue] = useState<string>(() =>
    buildInitialScopeValue(initialScopeValue, projectId),
  );
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateWorkItem();
  const { data: projectsData } = useProjects();
  const { data: groupsData } = useProjectGroups();
  const projects = projectsData?.projects ?? [];
  const groups = groupsData?.groups ?? [];

  const selectedGroupId = scopeValue.startsWith(SCOPE_GROUP_PREFIX)
    ? scopeValue.slice(SCOPE_GROUP_PREFIX.length)
    : undefined;
  const selectedProjectId = scopeValue.startsWith(SCOPE_PROJECT_PREFIX)
    ? scopeValue.slice(SCOPE_PROJECT_PREFIX.length)
    : undefined;

  const { data: groupDetail } = useProjectGroup(selectedGroupId);

  // 项目组模式下使用 primary 项目作为 project_id、拉取成员与版本；
  // 项目模式下使用所选项目 id；fallback 至 props.projectId 以兼容旧调用方。
  const primaryProjectId = useMemo(() => {
    if (!groupDetail) return undefined;
    const primary = groupDetail.members.find((m) => m.role === "primary");
    return primary?.project_id ?? groupDetail.members[0]?.project_id;
  }, [groupDetail]);

  const effectiveProjectId = selectedGroupId
    ? (primaryProjectId ?? projectId)
    : (selectedProjectId ?? projectId);

  const { data: versions = [] } = useVersions(effectiveProjectId);
  const { data: membersData } = useProjectMembers(effectiveProjectId);

  // 归属变更时重置下拉选择，避免跨项目残留选项
  useEffect(() => {
    setVersionId("");
    setAssignee("");
  }, [scopeValue]);

  // 归属下拉：项目分组 + 项目组分组
  const scopeFlatOptions = useMemo(() => {
    // 当 props.projectId 不在项目列表中时（例如调用方传入了非法 id 或项目列表尚未加载完成），
    // 提供一个隐藏 fallback 选项保证 <select> 受控值能匹配。
    const inProjects = projects.some((p) => p.id === projectId);
    if (!projectId || inProjects) return [] as { value: string; label: string }[];
    return [
      {
        value: `${SCOPE_PROJECT_PREFIX}${projectId}`,
        label: "当前项目",
      },
    ];
  }, [projects, projectId]);

  const scopeGroups = useMemo<SelectOptionGroup[]>(() => {
    const res: SelectOptionGroup[] = [];
    if (projects.length > 0) {
      res.push({
        label: "项目",
        options: projects.map((p) => ({
          value: `${SCOPE_PROJECT_PREFIX}${p.id}`,
          label: p.name,
        })),
      });
    }
    if (groups.length > 0) {
      res.push({
        label: "项目组",
        options: groups.map((g) => ({
          value: `${SCOPE_GROUP_PREFIX}${g.id}`,
          label: `${g.name} (${g.member_count})`,
        })),
      });
    }
    return res;
  }, [projects, groups]);

  const assigneeOptions = useMemo(() => {
    const opts = [{ value: "", label: "未指定" }];
    for (const m of membersData?.members ?? []) {
      const name = m.display_name || m.username;
      opts.push({ value: name, label: name });
    }
    return opts;
  }, [membersData]);

  const versionOptions = useMemo(() => {
    const opts = [{ value: "", label: "不关联版本" }];
    for (const v of versions) {
      const suffix =
        v.status === "released"
          ? " · 已发布"
          : v.status === "archived"
            ? " · 已归档"
            : "";
      opts.push({ value: v.id, label: `${v.name}${suffix}` });
    }
    return opts;
  }, [versions]);

  const handleSubmit = async () => {
    setError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("标题不能为空");
      return;
    }
    if (selectedGroupId && !primaryProjectId) {
      setError("项目组成员为空，请先为该组添加项目");
      return;
    }
    if (!effectiveProjectId) {
      setError("请先选择项目或项目组");
      return;
    }

    try {
      await createMutation.mutateAsync({
        project_id: effectiveProjectId,
        title: trimmedTitle,
        description: description.trim() || undefined,
        priority: Number(priority),
        assignee: assignee.trim() || undefined,
        tags: tagsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        version_id: versionId || null,
        group_id: selectedGroupId ?? null,
      });
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl animate-in zoom-in-95 fade-in-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              新建工作项
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              在所选项目或项目组中创建一个新的工作项
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="space-y-5 p-6">
          <Field label="归属" required>
            <Select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              options={scopeFlatOptions}
              groups={scopeGroups}
              className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
              aria-label="选择项目或项目组"
            />
            {selectedGroupId && groupDetail && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                将在 primary 项目{" "}
                <span className="font-mono text-foreground">
                  {groupDetail.members.find((m) => m.role === "primary")
                    ?.name ??
                    groupDetail.members[0]?.name ??
                    "—"}
                </span>{" "}
                中创建，后端会为 Agent 节点注入跨仓库上下文。
              </p>
            )}
          </Field>

          <Field label="标题" required>
            <Input
              autoFocus
              placeholder="输入工作项标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10 rounded-lg border-0 bg-muted/50 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
          </Field>

          <Field label="描述">
            <textarea
              placeholder="可选的详细描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <AIOptimizeButton
              description={description}
              onOptimized={setDescription}
              disabled={!description.trim()}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="优先级">
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
                options={PRIORITY_OPTIONS}
              />
            </Field>

            <Field label="负责人">
              <Select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                options={assigneeOptions}
                className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
              />
            </Field>
          </div>

          <Field label="标签（逗号分隔）">
            <Input
              placeholder="bug, feature, urgent"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="h-10 rounded-lg border-0 bg-muted/50 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
          </Field>

          <Field label="版本（可选）">
            <Select
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              options={versionOptions}
              className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
            />
          </Field>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border/60 bg-muted/20 px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={createMutation.isPending}
            onClick={handleSubmit}
          >
            {createMutation.isPending ? "创建中…" : "创建工作项"}
          </Button>
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
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
