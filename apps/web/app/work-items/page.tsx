"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select } from "@tide/ui";
import {
  useProjects,
  useProjectMembers,
  useVersions,
  type ProjectInfo,
  type WorkItemFilters,
} from "@tide/core";
import {
  WorkItemBoard,
  WorkItemCreateDialog,
  WorkItemDetailPanel,
  WorkItemListView,
  type WorkItemGroupBy,
} from "@tide/views";
import type { WorkItem } from "@tide/core";
import { LayoutGrid, List, Search } from "lucide-react";

const LAST_PROJECT_STORAGE_KEY = "tide:work-items:last-project-id";
const VIEW_MODE_STORAGE_KEY = "tide:work-items:view-mode";
const REFRESH_INTERVAL_STORAGE_KEY = "tide:work-items:refresh-interval";

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
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
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

  // 获取项目成员列表（用于负责人筛选下拉）
  const { data: membersData } = useProjectMembers(selectedProjectId || undefined);
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
  const { data: versions } = useVersions(selectedProjectId || undefined);
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

  // 项目变更时重置版本筛选（避免带到另一项目）
  useEffect(() => {
    setVersionFilter("");
  }, [selectedProjectId]);

  // 构建筛选参数
  const filters: WorkItemFilters | undefined = useMemo(() => {
    const f: WorkItemFilters = {};
    if (search.trim()) f.search = search.trim();
    if (statusFilter) f.status = statusFilter;
    if (assigneeFilter) f.assignee = assigneeFilter;
    if (versionFilter) f.version_id = versionFilter;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [search, statusFilter, assigneeFilter, versionFilter]);

  // 看板传递的 versionId：空字串表示不过滤
  const boardVersionId = versionFilter || undefined;

  // 默认选中：localStorage 上次选择 > last_active 最新的项目
  useEffect(() => {
    if (didInit || projectsLoading || projects.length === 0) return;

    let next = "";
    try {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY)
          : null;
      if (saved && projects.some((p) => p.id === saved)) {
        next = saved;
      }
    } catch {
      // ignore localStorage 异常（隐私模式 / SSR）
    }

    if (!next) {
      next = pickMostRecentProjectId(projects);
    }

    if (next) setSelectedProjectId(next);
    setDidInit(true);
  }, [projects, projectsLoading, didInit]);

  // 选中项目时持久化，便于下次进入恢复
  useEffect(() => {
    if (!selectedProjectId) return;
    try {
      window.localStorage.setItem(
        LAST_PROJECT_STORAGE_KEY,
        selectedProjectId,
      );
    } catch {
      // ignore
    }
  }, [selectedProjectId]);

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

  const projectOptions = [
    { value: "", label: "选择项目…" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const handleCardClick = (item: WorkItem) => {
    setDetailItemId(item.id);
  };

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
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              options={projectOptions}
              className="min-w-[200px]"
            />
            <Button
              disabled={!selectedProjectId}
              onClick={() => setShowCreate(true)}
            >
              ＋ 新建工作项
            </Button>
          </div>
        </div>
      </header>

      {/* 筛选栏 + 视图切换 */}
      {selectedProjectId && (
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
      ) : !selectedProjectId ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-card shadow-card py-20 text-center">
          <p className="text-sm text-muted-foreground">请选择项目</p>
          <p className="mt-2 text-base font-medium">
            请选择一个项目以查看其工作项
          </p>
        </div>
      ) : viewMode === "board" ? (
        <WorkItemBoard
          projectId={selectedProjectId}
          versionId={boardVersionId}
          onCardClick={handleCardClick}
          versionMap={versionMap}
          groupBy={groupBy}
          refetchInterval={refreshInterval}
        />
      ) : (
        <WorkItemListView
          projectId={selectedProjectId}
          filters={filters}
          onItemClick={handleCardClick}
        />
      )}

      {/* Create dialog */}
      {showCreate && selectedProjectId && (
        <WorkItemCreateDialog
          projectId={selectedProjectId}
          onClose={() => setShowCreate(false)}
        />
      )}

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
