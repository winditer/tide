"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@tide/ui";
import { useDeleteWorkflow, useToggleWorkflow } from "@tide/core";
import type { Workflow } from "@tide/core";

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface WorkflowListProps {
  items: Workflow[];
}

export function WorkflowList({ items }: WorkflowListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const del = useDeleteWorkflow();
  const toggle = useToggleWorkflow();

  const filtered = items.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      (w.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (items.length === 0) {
    return (
      <div className="bg-card rounded-xl p-16 text-center">
        <div className="text-xs font-medium text-muted-foreground">
          暂无工作流
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          点击右上角「创建工作流」开始
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      {/* Search */}
      <div className="border-b border-border/50 px-4 py-3">
        <Input
          placeholder="搜索工作流名称或描述..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm rounded-lg"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                名称
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                描述
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                节点
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                版本
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                更新时间
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                状态
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((w) => {
              const nodeCount = w.definition?.nodes?.length ?? 0;
              return (
                <tr
                  key={w.id}
                  className="cursor-pointer transition-colors hover:bg-muted/30"
                  onClick={() => router.push(`/workflows/${w.id}`)}
                >
                  <td className="px-4 py-3 font-semibold text-foreground">
                    {w.name}
                  </td>
                  <td className="max-w-xs px-4 py-3 truncate text-muted-foreground">
                    {w.description || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {nodeCount} 个
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    v{w.version}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatTime(w.updated_at)}
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(w.id)}
                      title={w.enabled ? "点击禁用" : "点击启用"}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-smooth disabled:opacity-50 ${
                        w.enabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${w.enabled ? "bg-emerald-500" : "bg-zinc-400"}`} />
                      {w.enabled ? "已启用" : "已禁用"}
                    </button>
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push(`/workflows/${w.id}`)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`确定删除「${w.name}」？`)) {
                            del.mutate(w.id);
                          }
                        }}
                        disabled={del.isPending}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && items.length > 0 && (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          无匹配结果
        </div>
      )}
    </div>
  );
}
