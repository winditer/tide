"use client";

import { useState } from "react";
import { Button } from "@tide/ui";
import {
  useDeleteProjectGroup,
  useProjectGroups,
  type ProjectGroupSummary,
  type ProjectInfo,
} from "@tide/core";
import { ProjectGroupCard } from "./ProjectGroupCard";
import { ProjectGroupCreateDialog } from "./ProjectGroupCreateDialog";

export interface ProjectGroupListProps {
  /** 用于创建对话框的候选项目列表。 */
  projects: ProjectInfo[];
  workspaceId?: string;
  onSelectGroup?: (group: ProjectGroupSummary) => void;
  /**
   * 当外部接管创建按钮和对话框时传入此回调。
   * - 列表内部不再渲染顶部的 "+ 新建项目组" 按钮；
   * - 空态/列表内的创建按钮仅触发该回调，不再持有自己的对话框状态；
   * - 适用于将创建按钮上移到 Tab 上方页头的场景。
   */
  onRequestCreate?: () => void;
}

/**
 * 项目组列表视图：网格 + 新建按钮 + 创建对话框 + 空态。
 * 作为 ``ProjectsPage`` 中"项目组"Tab 的主体内容。
 */
export function ProjectGroupList({
  projects,
  workspaceId,
  onSelectGroup,
  onRequestCreate,
}: ProjectGroupListProps) {
  const externalCreate = typeof onRequestCreate === "function";
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const triggerCreate = () => {
    if (externalCreate) {
      onRequestCreate!();
    } else {
      setShowCreate(true);
    }
  };

  const { data, isLoading, isError } = useProjectGroups(workspaceId);
  const deleteMutation = useDeleteProjectGroup();
  const groups = data?.groups ?? [];

  return (
    <section className="space-y-6">
      {!externalCreate && (
        <div className="flex items-center justify-end">
          <Button onClick={() => setShowCreate(true)}>＋ 新建项目组</Button>
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-destructive">
          加载失败
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-card py-20 text-center shadow-card">
          <p className="text-sm text-muted-foreground">暂无项目组</p>
          <p className="mt-2 text-base font-medium">
            将多个仓库聚合，便于跨仓库工作项编排
          </p>
          <div className="mt-6">
            <Button onClick={triggerCreate}>＋ 新建项目组</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <ProjectGroupCard
              key={g.id}
              group={g}
              onClick={onSelectGroup}
              isDeleting={
                deleteMutation.isPending && pendingDeleteId === g.id
              }
              onDelete={async (group) => {
                if (
                  !confirm(
                    `删除项目组 "${group.name}" ？\n（不会删除组内项目本身）`,
                  )
                ) {
                  return;
                }
                setPendingDeleteId(group.id);
                try {
                  await deleteMutation.mutateAsync(group.id);
                } finally {
                  setPendingDeleteId(null);
                }
              }}
            />
          ))}
        </div>
      )}

      {!externalCreate && showCreate && (
        <ProjectGroupCreateDialog
          projects={projects}
          workspaceId={workspaceId}
          onClose={() => setShowCreate(false)}
        />
      )}
    </section>
  );
}
