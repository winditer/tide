"use client";

import { useState } from "react";
import { Button, Select } from "@tide/ui";
import { useProjects, type ProjectInfo } from "@tide/core";
import {
  WorkItemBoard,
  WorkItemCreateDialog,
  WorkItemDetailPanel,
} from "@tide/views";
import type { WorkItem } from "@tide/core";

export default function WorkItemsPage() {
  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const projects: ProjectInfo[] = projectsData?.projects ?? [];

  // Auto-select first project if none selected
  if (!selectedProjectId && projects.length > 0 && !projectsLoading) {
    // Use effect-free approach: let user pick
  }

  const projectOptions = [
    { value: "", label: "选择项目…" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const handleCardClick = (item: WorkItem) => {
    setDetailItemId(item.id);
  };

  return (
    <main className="mx-auto max-w-7xl px-2 py-2">
      {/* Editorial hero */}
      <header className="mb-8 border-b-2 border-zinc-900 pb-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[11px] tracking-[0.4em] text-zinc-500">
              WORKFLOW · KANBAN
            </div>
            <h1 className="mt-2 font-serif text-5xl font-bold leading-none tracking-tight text-zinc-900">
              Work Items<span className="text-emerald-600">.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm text-zinc-600">
              可视化管理项目中的工作项，拖拽卡片即可流转状态。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              options={projectOptions}
              className="min-w-[200px] border-2 border-zinc-900 shadow-[3px_3px_0_0_rgba(24,24,27,1)]"
            />
            <Button
              disabled={!selectedProjectId}
              className="border-2 border-zinc-900 bg-emerald-600 text-white shadow-[3px_3px_0_0_rgba(24,24,27,1)] hover:bg-emerald-700"
              onClick={() => setShowCreate(true)}
            >
              ＋ 新建工作项
            </Button>
          </div>
        </div>
      </header>

      {/* Board content */}
      {projectsLoading ? (
        <div className="py-16 text-center font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING PROJECTS…
        </div>
      ) : !selectedProjectId ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-300 py-20 text-center">
          <div className="font-mono text-[11px] tracking-[0.3em] text-zinc-400">
            SELECT A PROJECT
          </div>
          <p className="mt-3 font-serif text-xl text-zinc-600">
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
