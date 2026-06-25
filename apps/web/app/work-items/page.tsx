"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select, type SelectOptionGroup } from "@tide/ui";
import {
  useProjects,
  useProjectMembers,
  useProjectGroups,
  useProjectGroup,
  useVersions,
  type ProjectInfo,
  type WorkItemFilters,
} from "@tide/core";
import {
  WorkItemBoard,
  WorkItemCreateDialog,
  WorkItemDetailPanel,
  WorkItemListView,
  AIDecomposeDialog,
  type WorkItemGroupBy,
} from "@tide/views";
import type { WorkItem } from "@tide/core";
import { LayoutGrid, List, Search, Sparkles } from "lucide-react";

const LAST_SCOPE_STORAGE_KEY = "tide:work-items:last-scope";
/** 兼容旧版本 localStorage 中仅存项目 id 的 key */
const LEGACY_PROJECT_STORAGE_KEY = "tide:work-items:last-project-id";
const VIEW_MODE_STORAGE_KEY = "tide:work-items:view-mode";
const REFRESH_INTERVAL_STORAGE_KEY = "tide:work-items:refresh-interval";

const SCOPE_ALL = "__all__";
const SCOPE_PROJECT_PREFIX = "project:";
const SCOPE_GROUP_PREFIX = "group:";

const REFRESH_INTERVAL_OPTIONS = [
  { value: 0, label: "手动刷新" },
  { value: 30_000, label: "30 秒" },
  { value: 60_000, label: "1 分钟" },
  { value: 300_000, label: "5 分钟" },
];

/** 取 last_active 最新的项目 id；为空时退化为列表第一个。 */
function pickMostRecentProjectId(projects: ProjectInfo[]): string {
  if (projects.length === 0) return "";
  const sorted = [...projects].sort((a, b) => {
    const av = a.last_active || "";
    const bv = b.last_active || "";
    if (av === bv) return 0;
    return av < bv ? 1 : -1;
  });
  return sorted[0]?.id ?? "";
}

/**
 * 解析 scope 编码值。
 * - ``""`` / ``"__all__"`` -> 全部
 * - ``"project:<id>"`` -> 选中具体项目
 * - ``"group:<id>"``   -> 选中具体项目组
 */
function parseScope(value: string): {
  kind: "all" | "project" | "group";
  id: string;
} {
  if (!value || value === SCOPE_ALL) return { kind: "all", id: "" };
  if (value.startsWith(SCOPE_PROJECT_PREFIX)) {
    return { kind: "project", id: value.slice(SCOPE_PROJECT_PREFIX.length) };
  }
  if (value.startsWith(SCOPE_GROUP_PREFIX)) {
    return { kind: "group", id: value.slice(SCOPE_GROUP_PREFIX.length) };
  }
  // 兼容旧 localStorage：纯 project id（无前缀），按项目处理
  return { kind: "project", id: value };
}

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "pending", label: "待操作" },
  { value: "in_progress", label: "进行中" },
  { value: "pending_approval", label: "待审批" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "stopped", label: "已停止" },
  { value: "waiting", label: "等待中" },
];

export default function WorkItemsPage() {
  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const { data: projectGroupsData } = useProjectGroups();

  // 统一归属选择器：编码形式 "project:<id>" / "group:<id>" / "__all__"
  const [scopeValue, setScopeValue] = useState<string>(SCOPE_ALL);
  const [showCreate, setShowCreate] = useState(false);
  const [showAIDecompose, setShowAIDecompose] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [didInit, setDidInit] = useState(false);

  // 视图模式
  const [viewMode, setViewMode] = useState<"board" | "list">(() => {
    if (typeof window === "undefined") return "board";
    try {
      const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === "list") return "list";
    } catch {}
    return "board";
  });

  // 看板自动刷新间隔（毫秒），0 = 手动刷新
  const [refreshInterval, setRefreshInterval] = useState<number>(() => {
    if (typeof window === "undefined") return 60_000;
    try {
      const saved = window.localStorage.getItem(REFRESH_INTERVAL_STORAGE_KEY);
      if (saved !== null) {
        const v = Number(saved);
        if (!Number.isNaN(v) && v >= 0) return v;
      }
    } catch {}
    return 60_000;
  });

  // 筛选状态
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [versionFilter, setVersionFilter] = useState("");
  const [groupBy, setGroupBy] = useState<WorkItemGroupBy>("none");

  const projects: ProjectInfo[] = useMemo(
    () => projectsData?.projects ?? [],
    [projectsData],
  );
  const groups = useMemo(
    () => projectGroupsData?.groups ?? [],
    [projectGroupsData],
  );

  const scope = useMemo(() => parseScope(scopeValue), [scopeValue]);

  // 项目组模式：拉取详情以确定 primary 项目作为视图的 projectId
  const { data: groupDetail } = useProjectGroup(
    scope.kind === "group" ? scope.id : undefined,
  );
  const groupPrimaryProjectId = useMemo(() => {
    if (scope.kind !== "group" || !groupDetail) return "";
    const primary = groupDetail.members.find((m) => m.role === "primary");
    return primary?.project_id ?? groupDetail.members[0]?.project_id ?? "";
  }, [scope, groupDetail]);

  /** 实际驱动看板/列表加载的项目 id */
  const effectiveProjectId =
    scope.kind === "project"
      ? scope.id
      : scope.kind === "group"
        ? groupPrimaryProjectId
        : "";

  // 获取项目成员列表（用于负责人筛选下拉）
  const { data: membersData } = useProjectMembers(
    effectiveProjectId || undefined,
  );
  const memberOptions = useMemo(() => {
    const opts = [{ value: "", label: "全部负责人" }];
    if (membersData?.members) {
      for (const m of membersData.members) {
        const name = m.display_name || m.username;
        opts.push({ value: name, label: name });
      }
    }
    return opts;
  }, [membersData]);

  // 获取项目版本列表（用于版本筛选下拉）
  const { data: versions } = useVersions(effectiveProjectId || undefined);
  const versionOptions = useMemo(() => {
    const opts = [{ value: "", label: "全部版本" }];
    for (const v of versions ?? []) {
      opts.push({ value: v.id, label: v.name });
    }
    return opts;
  }, [versions]);

  // 版本 id -> 名称映射，传给看板用于卡片版本徽标 / 按版本分组泳道标题
  const versionMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const v of versions ?? []) {
      map[v.id] = v.name;
    }
    return map;
  }, [versions]);

  // 归属变更时重置版本/负责人筛选，避免带到另一项目
  useEffect(() => {
    setVersionFilter("");
    setAssigneeFilter("");
  }, [scopeValue]);

  // 构建筛选参数：项目组模式自动注入 group_id
  const filters: WorkItemFilters | undefined = useMemo(() => {
    const f: WorkItemFilters = {};
    if (search.trim()) f.search = search.trim();
    if (statusFilter) f.status = statusFilter;
    if (assigneeFilter) f.assignee = assigneeFilter;
    if (versionFilter) f.version_id = versionFilter;
    if (scope.kind === "group" && scope.id) f.group_id = scope.id;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [search, statusFilter, assigneeFilter, versionFilter, scope]);

  // 看板传递的 versionId：空字串表示不过滤
  const boardVersionId = versionFilter || undefined;

  // 归属下拉选项：扁平 + 两组（项目 / 项目组）
  const scopeFlatOptions = useMemo(
    () => [{ value: SCOPE_ALL, label: "全部" }],
    [],
  );
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

  // 默认选中：上次选择 > last_active 最新的项目
  useEffect(() => {
    if (didInit || projectsLoading) return;
    if (projects.length === 0 && groups.length === 0) return;

    let next = "";
    try {
      if (typeof window !== "undefined") {
        const savedScope = window.localStorage.getItem(LAST_SCOPE_STORAGE_KEY);
        if (savedScope) {
          const parsed = parseScope(savedScope);
          if (
            parsed.kind === "project" &&
            projects.some((p) => p.id === parsed.id)
          ) {
            next = `${SCOPE_PROJECT_PREFIX}${parsed.id}`;
          } else if (
            parsed.kind === "group" &&
            groups.some((g) => g.id === parsed.id)
          ) {
            next = `${SCOPE_GROUP_PREFIX}${parsed.id}`;
          }
        }
        // 回退：旧 key 中仅存了 project id
        if (!next) {
          const legacy = window.localStorage.getItem(
            LEGACY_PROJECT_STORAGE_KEY,
          );
          if (legacy && projects.some((p) => p.id === legacy)) {
            next = `${SCOPE_PROJECT_PREFIX}${legacy}`;
          }
        }
      }
    } catch {
      // ignore localStorage 异常（隐私模式 / SSR）
    }

    if (!next) {
      const recent = pickMostRecentProjectId(projects);
      if (recent) next = `${SCOPE_PROJECT_PREFIX}${recent}`;
    }

    if (next) setScopeValue(next);
    setDidInit(true);
  }, [projects, groups, projectsLoading, didInit]);

  // 选中变更时持久化，便于下次进入恢复
  useEffect(() => {
    if (scope.kind === "all") return;
    try {
      window.localStorage.setItem(LAST_SCOPE_STORAGE_KEY, scopeValue);
    } catch {
      // ignore
    }
  }, [scopeValue, scope]);

  // 持久化视图模式
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {}
  }, [viewMode]);

  // 持久化刷新间隔
  useEffect(() => {
    try {
      window.localStorage.setItem(
        REFRESH_INTERVAL_STORAGE_KEY,
        String(refreshInterval),
      );
    } catch {}
  }, [refreshInterval]);

  const handleCardClick = (item: WorkItem) => {
    setDetailItemId(item.id);
  };

  // 是否已选中具体归属（用于决定是否渲染列表/筛选栏）
  const hasScope = scope.kind !== "all" && !!effectiveProjectId;

  return (
    <main className="mx-auto max-w-7xl px-2 py-2 space-y-6">
      {/* Header */}
      <header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">工作项</h1>
            <p className="text-sm text-muted-foreground mt-1">
              可视化管理项目中的工作项，拖拽卡片即可流转状态。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              options={scopeFlatOptions}
              groups={scopeGroups}
              className="min-w-[220px]"
              aria-label="选择项目或项目组"
              title="选择项目或项目组"
            />
            <Button
              variant="outline"
              disabled={!hasScope}
              onClick={() => setShowAIDecompose(true)}
              className="gap-1.5"
              title="使用 AI 将需求拆解为多个工作项"
            >
              <Sparkles className="h-4 w-4" />
              AI 分解
            </Button>
            <Button disabled={!hasScope} onClick={() => setShowCreate(true)}>
              ＋ 新建工作项
            </Button>
          </div>
        </div>
      </header>

      {/* 筛选栏 + 视图切换 */}
      {hasScope && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* 筛选 */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索标题或内容…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-56"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={STATUS_OPTIONS}
              className="w-32"
            />
            <Select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              options={memberOptions}
              className="w-36"
            />
            <Select
              value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value)}
              options={versionOptions}
              className="w-36"
            />
            {viewMode === "board" && (
              <Select
                value={groupBy}
                onChange={(e) =>
                  setGroupBy(e.target.value as WorkItemGroupBy)
                }
                options={[
                  { value: "none", label: "不分组" },
                  { value: "assignee", label: "按负责人" },
                  { value: "priority", label: "按优先级" },
                  { value: "version", label: "按版本" },
                ]}
                className="w-28"
                aria-label="分组方式"
              />
            )}
          </div>

          {/* 视图切换 + 刷新间隔 */}
          <div className="flex items-center gap-2">
            {viewMode === "board" && (
              <Select
                value={String(refreshInterval)}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                options={REFRESH_INTERVAL_OPTIONS.map((o) => ({
                  value: String(o.value),
                  label: o.label,
                }))}
                className="w-28"
                aria-label="自动刷新间隔"
                title="看板自动刷新间隔"
              />
            )}
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
              <button
                onClick={() => setViewMode("board")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === "board"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                看板
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === "list"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                列表
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 内容区域 */}
      {projectsLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载项目中…
        </div>
      ) : !hasScope ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-card shadow-card py-20 text-center">
          <p className="text-sm text-muted-foreground">
            {scope.kind === "group"
              ? "项目组成员为空，请先为该组添加项目"
              : "请选择项目或项目组"}
          </p>
          <p className="mt-2 text-base font-medium">
            {scope.kind === "group"
              ? "无可用的 primary 项目"
              : "请从右上角选择一个项目或项目组以查看其工作项"}
          </p>
        </div>
      ) : viewMode === "board" ? (
        <WorkItemBoard
          projectId={effectiveProjectId}
          versionId={boardVersionId}
          onCardClick={handleCardClick}
          versionMap={versionMap}
          groupBy={groupBy}
          refetchInterval={refreshInterval}
        />
      ) : (
        <WorkItemListView
          projectId={effectiveProjectId}
          filters={filters}
          onItemClick={handleCardClick}
        />
      )}

      {/* Create dialog */}
      {showCreate && hasScope && (
        <WorkItemCreateDialog
          projectId={effectiveProjectId}
          initialScopeValue={scopeValue}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* AI 分解弹窗 */}
      <AIDecomposeDialog
        open={showAIDecompose && hasScope}
        onOpenChange={setShowAIDecompose}
        projectId={effectiveProjectId}
        groupId={scope.kind === "group" ? scope.id : undefined}
      />

      {/* Detail panel */}
      {detailItemId && (
        <WorkItemDetailPanel
          itemId={detailItemId}
          onClose={() => setDetailItemId(null)}
        />
      )}
    </main>
  );
}
