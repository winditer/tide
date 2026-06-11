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
      <div className="border-2 border-dashed border-zinc-400 bg-white px-6 py-16 text-center shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
        <div className="font-mono text-[11px] tracking-[0.3em] text-zinc-500">
          ◇ NO WORKFLOWS YET
        </div>
        <div className="mt-2 text-sm text-zinc-500">
          点击右上角「创建工作流」开始
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden border-2 border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 bg-emerald-400" />
          <span className="font-mono text-[11px] tracking-[0.3em]">
            ◳ WORKFLOWS
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-widest text-zinc-400">
          {items.length} ITEMS
        </span>
      </div>

      {/* Search */}
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <Input
          placeholder="搜索工作流名称或描述..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-zinc-900 bg-zinc-50">
              <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                NAME
              </th>
              <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                DESCRIPTION
              </th>
              <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                NODES
              </th>
              <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                VER
              </th>
              <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                UPDATED
              </th>
              <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                STATUS
              </th>
              <th className="px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700">
                ACTIONS
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => {
              const nodeCount = w.definition?.nodes?.length ?? 0;
              return (
                <tr
                  key={w.id}
                  className="cursor-pointer border-b border-zinc-200 transition-colors hover:bg-zinc-50"
                  onClick={() => router.push(`/workflows/${w.id}`)}
                >
                  <td className="px-3 py-3 font-semibold text-zinc-900">
                    {w.name}
                  </td>
                  <td className="max-w-xs px-3 py-3 truncate text-zinc-600">
                    {w.description || "—"}
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-zinc-700">
                    ◰ {nodeCount}
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-zinc-700">
                    v{w.version}
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-zinc-700">
                    {formatTime(w.updated_at)}
                  </td>
                  <td
                    className="px-3 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(w.id)}
                      title={w.enabled ? "点击禁用" : "点击启用"}
                      className={`inline-flex items-center gap-1 border-2 px-2 py-[2px] font-mono text-[10px] tracking-[0.2em] transition-all hover:translate-x-[1px] hover:translate-y-[1px] disabled:opacity-50 ${
                        w.enabled
                          ? "border-emerald-700 bg-emerald-50 text-emerald-800 shadow-[2px_2px_0_0_rgba(4,120,87,0.6)] hover:shadow-none"
                          : "border-zinc-500 bg-zinc-100 text-zinc-600 shadow-[2px_2px_0_0_rgba(82,82,91,0.5)] hover:shadow-none"
                      }`}
                    >
                      {w.enabled ? "● ENABLED" : "○ DISABLED"}
                    </button>
                  </td>
                  <td
                    className="px-3 py-3"
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
        <div className="px-4 py-8 text-center font-mono text-[11px] tracking-widest text-zinc-500">
          ◇ NO MATCHES
        </div>
      )}
    </div>
  );
}
