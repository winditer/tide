"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Select } from "@tide/ui";
import { usePlans, useProjects } from "@tide/core";
import { PlanList, PlanCreateForm } from "@tide/views";

const STATUS_FILTERS = [
  { label: "全部", value: "" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Stopped", value: "stopped" },
];

function PlansPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Auto-open create dialog when ?action=create is present
  useEffect(() => {
    if (searchParams.get("action") === "create") {
      setShowCreate(true);
      // Strip the query param so refreshing doesn't re-open
      router.replace("/plans");
    }
  }, [searchParams, router]);

  const { data: projectsData } = useProjects();
  const projectOptions = useMemo(() => {
    return [
      { label: "全部项目", value: "" },
      ...(projectsData?.projects ?? []).map((p) => ({
        label: p.name === p.cwd ? p.cwd : `${p.name}  ·  ${p.cwd}`,
        value: p.cwd,
      })),
    ];
  }, [projectsData]);

  const { data, isLoading, isError } = usePlans({
    status: status || undefined,
    project: project || undefined,
    limit: 50,
  });

  const hasActiveFilter = !!status || !!project;
  const handleReset = () => {
    setStatus("");
    setProject("");
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Plan 管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            将复杂工作分解为带依赖的任务图谱，审批、并行、可视化时间线一气呵成。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {data?.length ?? 0} 个 Plan
          </span>
          <Button onClick={() => setShowCreate(true)}>+ 新建 Plan</Button>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-card rounded-xl shadow-card p-5 transition-smooth">
        <div className="flex flex-wrap items-end gap-6">
          {/* Status filter — segmented buttons */}
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">状态</div>
            <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1 h-9">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatus(f.value)}
                  className={[
                    "rounded-md px-3 py-1 text-xs transition-smooth h-7",
                    status === f.value
                      ? "bg-card text-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Project filter — Select */}
          <div className="min-w-[260px] flex-1 max-w-md">
            <div className="mb-2 text-xs font-medium text-muted-foreground">项目</div>
            <Select
              options={projectOptions}
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Reset */}
          <button
            type="button"
            disabled={!hasActiveFilter}
            onClick={handleReset}
            className={[
              "rounded-md px-3 py-1.5 text-xs transition-smooth",
              hasActiveFilter
                ? "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                : "cursor-not-allowed text-muted-foreground/50",
            ].join(" ")}
          >
            清空筛选
          </button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-muted-foreground transition-smooth">
          加载中...
        </div>
      ) : isError ? (
        <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-destructive transition-smooth">
          加载失败，请重试
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden hover:shadow-card-hover transition-smooth">
          <PlanList
            plans={data ?? []}
            onCreate={() => setShowCreate(true)}
          />
        </div>
      )}

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-auto bg-card rounded-xl shadow-card-hover">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-card px-5 py-3">
              <span className="text-sm font-semibold">新建 Plan</span>
              <button
                onClick={() => setShowCreate(false)}
                className="text-muted-foreground hover:text-foreground transition-smooth"
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              <PlanCreateForm
                onSuccess={(planId) => {
                  setShowCreate(false);
                  window.location.href = `/plans/${planId}`;
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlansPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-muted-foreground">
          加载中...
        </div>
      }
    >
      <PlansPageInner />
    </Suspense>
  );
}
