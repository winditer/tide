"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "@tide/ui";
import { useProjects, type ProjectInfo } from "@tide/core";
import {
  WorkItemBoard,
  WorkItemCreateDialog,
  WorkItemDetailPanel,
} from "@tide/views";
import type { WorkItem } from "@tide/core";

const LAST_PROJECT_STORAGE_KEY = "tide:work-items:last-project-id";

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

export default function WorkItemsPage() {
  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [didInit, setDidInit] = useState(false);

  const projects: ProjectInfo[] = useMemo(
    () => projectsData?.projects ?? [],
    [projectsData],
  );

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

  const projectOptions = [
    { value: "", label: "选择项目…" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const handleCardClick = (item: WorkItem) => {
    setDetailItemId(item.id);
  };

  return (
    <main className="mx-auto max-w-7xl px-2 py-2 space-y-8">
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

      {/* Board content */}
      {projectsLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载项目中…
        </div>
      ) : !selectedProjectId ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-card shadow-card py-20 text-center">
          <p className="text-sm text-muted-foreground">请选择项目</p>
          <p className="mt-2 text-base font-medium">
            请选择一个项目以查看其工作项看板
          </p>
        </div>
      ) : (
        <WorkItemBoard
          projectId={selectedProjectId}
          onCardClick={handleCardClick}
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
