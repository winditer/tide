"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@tide/ui";
import { useWorkflows, useAuth } from "@tide/core";
import { WorkflowList, WorkflowCreateForm, WorkflowGuide } from "@tide/views";

export default function WorkflowsPage() {
  const router = useRouter();
  const { data, isLoading, isError, error } = useWorkflows();
  const [showCreate, setShowCreate] = useState(false);
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      {/* Page header */}
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">工作流</h1>
          <p className="text-sm text-muted-foreground mt-1">
            可视化构建多 Agent 协作的 DAG 工作流。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkflowGuide />
          <Button
            onClick={() => setShowCreate(true)}
            disabled={user?.role === "viewer"}
            title={user?.role === "viewer" ? "查看权限无法创建工作流" : undefined}
          >
            + 创建工作流
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="bg-card rounded-xl shadow-card px-4 py-12 text-center text-sm text-muted-foreground transition-smooth">
          加载中...
        </div>
      ) : isError ? (
        <div className="bg-card rounded-xl shadow-card px-4 py-12 text-center text-sm text-destructive transition-smooth">
          加载失败 — {String(error)}
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden hover:shadow-card-hover transition-smooth">
          <WorkflowList items={data ?? []} />
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg bg-card rounded-xl shadow-card-hover overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
              <span className="text-sm font-semibold">创建工作流</span>
              <button
                onClick={() => setShowCreate(false)}
                className="text-muted-foreground hover:text-foreground transition-smooth"
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
    </div>
  );
}
