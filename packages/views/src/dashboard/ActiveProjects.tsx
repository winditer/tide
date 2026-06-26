"use client";

import Link from "next/link";
import { ChevronRight, FolderOpen } from "lucide-react";
import { useActiveProjects } from "@tide/core";
import { formatRelativeTime } from "./format-time";

export function ActiveProjects() {
  const { data, isLoading, isError } = useActiveProjects(3);
  const projects = data ?? [];

  return (
    <section className="rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            活跃项目
          </h2>
        </div>
        <Link
          href="/projects"
          className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          全部 →
        </Link>
      </header>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-gray-400">加载中...</div>
      ) : isError ? (
        <div className="py-6 text-center text-sm text-red-500">加载失败</div>
      ) : projects.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">
          暂无活跃项目
        </div>
      ) : (
        <ul className="space-y-1">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-indigo-50/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900 group-hover:text-indigo-700">
                      {p.name}
                    </p>
                    {p.running_count > 0 && (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                    <span>{p.task_count} 个任务</span>
                    {p.running_count > 0 && (
                      <span className="text-emerald-600">
                        {p.running_count} 运行中
                      </span>
                    )}
                    <span className="ml-auto">
                      {formatRelativeTime(p.last_active)}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-indigo-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
