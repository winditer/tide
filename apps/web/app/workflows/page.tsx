"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@tide/ui";
import { useWorkflows } from "@tide/core";
import { WorkflowList, WorkflowCreateForm } from "@tide/views";

export default function WorkflowsPage() {
  const router = useRouter();
  const { data, isLoading, isError, error } = useWorkflows();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <main className="mx-auto max-w-7xl px-2 py-2">
      {/* Page header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
            ◳ ORCHESTRATION
          </div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-900">
            Workflows
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            可视化构建多 Agent 协作的 DAG 工作流
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ 创建工作流</Button>
      </div>

      {isLoading ? (
        <div className="border-2 border-zinc-900 bg-white px-4 py-12 text-center font-mono text-xs tracking-widest text-zinc-500 shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
          ◐ LOADING WORKFLOWS…
        </div>
      ) : isError ? (
        <div className="border-2 border-rose-700 bg-rose-50 px-4 py-12 text-center font-mono text-xs text-rose-700 shadow-[6px_6px_0_0_rgba(190,18,60,0.92)]">
          ✕ 加载失败 — {String(error)}
        </div>
      ) : (
        <WorkflowList items={data ?? []} />
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg border-2 border-zinc-900 bg-white shadow-[8px_8px_0_0_rgba(24,24,27,0.92)]">
            <div className="flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-4 py-3 text-white">
              <span className="font-mono text-[11px] tracking-[0.3em]">
                ◳ NEW WORKFLOW
              </span>
              <button
                onClick={() => setShowCreate(false)}
                className="font-mono text-sm text-zinc-300 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-5">
              <WorkflowCreateForm
                onSuccess={(id) => {
                  setShowCreate(false);
                  router.push(`/workflows/${id}`);
                }}
                onCancel={() => setShowCreate(false)}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
