"use client";

import { useMemo } from "react";
import {
  useWorkItems,
  useVersions,
  type WorkItem,
  type WorkItemStatus,
  type WorkItemFilters,
} from "@tide/core";

const STATUS_CONFIG: Record<WorkItemStatus, { label: string; color: string }> = {
  pending: { label: "待操作", color: "bg-gray-100 text-gray-700 border border-gray-200" },
  in_progress: { label: "进行中", color: "bg-blue-100 text-blue-700 border border-blue-200" },
  pending_approval: { label: "待审批", color: "bg-amber-100 text-amber-700 border border-amber-200" },
  completed: { label: "已完成", color: "bg-green-100 text-green-700 border border-green-200" },
  failed: { label: "失败", color: "bg-red-100 text-red-700 border border-red-200" },
  stopped: { label: "已停止", color: "bg-gray-200 text-gray-600 border border-gray-300" },
  waiting: { label: "等待中", color: "bg-purple-100 text-purple-700 border border-purple-200" },
};

const PRIORITY_CONFIG: Record<number, { label: string; color: string }> = {
  0: { label: "—", color: "" },
  1: { label: "低", color: "bg-blue-50 text-blue-700 border border-blue-200" },
  2: { label: "中", color: "bg-amber-50 text-amber-700 border border-amber-200" },
  3: { label: "高", color: "bg-orange-50 text-orange-700 border border-orange-200" },
  4: { label: "紧急", color: "bg-rose-50 text-rose-700 border border-rose-200" },
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface WorkItemListViewProps {
  projectId: string;
  filters?: WorkItemFilters;
  onItemClick?: (item: WorkItem) => void;
}

export function WorkItemListView({ projectId, filters, onItemClick }: WorkItemListViewProps) {
  const { data: items, isLoading, isError } = useWorkItems(projectId, filters);
  const { data: versions } = useVersions(projectId);

  const versionNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const v of versions ?? []) {
      map[v.id] = v.name;
    }
    return map;
  }, [versions]);

  if (isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        加载列表中…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-16 text-center text-sm text-destructive">
        列表加载失败
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/40 py-16 text-center">
        <p className="text-sm text-muted-foreground">暂无工作项</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground max-w-[280px]">标题</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-24">状态</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-24">负责人</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-28">版本</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-24">优先级</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">创建时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const statusCfg = item.status ? STATUS_CONFIG[item.status] : null;
            const priorityCfg = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG[0];

            return (
              <tr
                key={item.id}
                onClick={() => onItemClick?.(item)}
                className="border-b border-border/30 transition-colors hover:bg-muted/20 cursor-pointer last:border-b-0"
              >
                {/* 标题 */}
                <td className="px-4 py-3 max-w-[280px]">
                  <div className="font-medium text-foreground truncate">
                    {item.title || "(无标题)"}
                  </div>
                  {item.description && (
                    <div className="mt-0.5 text-xs text-muted-foreground truncate">
                      {item.description}
                    </div>
                  )}
                </td>

                {/* 状态 */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {statusCfg ? (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>

                {/* 负责人 */}
                <td className="px-4 py-3">
                  {item.assignee ? (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary">
                        {item.assignee.slice(0, 1)}
                      </span>
                      <span className="truncate max-w-[80px]">{item.assignee}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>

                {/* 版本 */}
                <td className="px-4 py-3">
                  {item.version_id ? (
                    <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {versionNameMap[item.version_id] || item.version_id.slice(0, 8)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>

                {/* 优先级 */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {item.priority > 0 ? (
                    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priorityCfg.color}`}>
                      {priorityCfg.label}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>

                {/* 创建时间 */}
                <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                  {formatTime(item.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
