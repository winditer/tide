"use client";

import { useMemo, useState } from "react";
import { Button, Select } from "@tide/ui";
import { usePlans, useProjects } from "@tide/core";
import { PlanList, PlanCreateForm } from "@tide/views";

const STATUS_FILTERS = [
  { label: "全部", value: "" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Stopped", value: "stopped" },
];

export default function PlansPage() {
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [showCreate, setShowCreate] = useState(false);

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
    <main className="mx-auto max-w-7xl px-2 py-2">
      {/* Editorial header */}
      <header className="mb-8 border-b-2 border-zinc-900 pb-6">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="font-mono text-[11px] tracking-[0.4em] text-zinc-500">
              MULTI-AGENT · ORCHESTRATION
            </div>
            <h1 className="mt-2 font-serif text-5xl font-bold leading-none tracking-tight text-zinc-900">
              Plan<span className="text-amber-500">.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm text-zinc-600">
              将复杂工作分解为带依赖的任务图谱。审批、并行、可视化时间线一气呵成。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] tracking-widest text-zinc-500">
              {data?.length ?? 0} ITEMS
            </span>
            <Button onClick={() => setShowCreate(true)}>+ 新建 Plan</Button>
          </div>
        </div>

        {/* Filter strip */}
        <div className="mt-6 flex flex-wrap items-end gap-4 font-mono text-[11px]">
          {/* Status filter — segmented buttons */}
          <div>
            <div className="mb-1 tracking-widest text-zinc-500">STATUS</div>
            <div className="flex items-center gap-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatus(f.value)}
                  className={[
                    "border border-zinc-900 px-3 py-1 transition-colors",
                    status === f.value
                      ? "bg-zinc-900 text-white"
                      : "bg-white text-zinc-700 hover:bg-zinc-100",
                  ].join(" ")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Project filter — Select */}
          <div className="min-w-[260px] flex-1 max-w-md">
            <div className="mb-1 tracking-widest text-zinc-500">PROJECT</div>
            <Select
              options={projectOptions}
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="rounded-none border-zinc-900 font-mono text-[11px]"
            />
          </div>

          {/* Reset */}
          <button
            type="button"
            disabled={!hasActiveFilter}
            onClick={handleReset}
            className={[
              "border border-zinc-900 px-3 py-1 tracking-widest transition-colors",
              hasActiveFilter
                ? "bg-white text-zinc-700 hover:bg-zinc-900 hover:text-white"
                : "cursor-not-allowed bg-zinc-100 text-zinc-400",
            ].join(" ")}
          >
            ✕ CLEAR
          </button>
        </div>
      </header>

      {/* Body */}
      {isLoading ? (
        <div className="py-16 text-center font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING…
        </div>
      ) : isError ? (
        <div className="py-16 text-center font-mono text-xs text-rose-600">
          ✕ FAILED TO LOAD PLANS
        </div>
      ) : (
        <PlanList
          plans={data ?? []}
          onCreate={() => setShowCreate(true)}
        />
      )}

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-auto border-2 border-zinc-900 bg-white shadow-[12px_12px_0_0_rgba(24,24,27,0.92)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-5 py-3 text-white">
              <span className="font-mono text-[11px] tracking-[0.3em]">
                NEW · PLAN COMPOSITION
              </span>
              <button
                onClick={() => setShowCreate(false)}
                className="font-mono text-sm text-zinc-300 hover:text-white"
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
    </main>
  );
}
