"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useMyWorkItems } from "@tide/core";
import type { MyWorkItem } from "@tide/core";

/** 工作项状态徽章配色：与 work-items 列表页 STATUS_CONFIG 保持一致。 */
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: {
    label: "待操作",
    color: "bg-gray-100 text-gray-700 border border-gray-200",
  },
  in_progress: {
    label: "进行中",
    color: "bg-blue-100 text-blue-700 border border-blue-200",
  },
  pending_approval: {
    label: "待审批",
    color: "bg-amber-100 text-amber-700 border border-amber-200",
  },
  completed: {
    label: "已完成",
    color: "bg-green-100 text-green-700 border border-green-200",
  },
  failed: {
    label: "失败",
    color: "bg-red-100 text-red-700 border border-red-200",
  },
  stopped: {
    label: "已停止",
    color: "bg-gray-200 text-gray-600 border border-gray-300",
  },
  waiting: {
    label: "等待中",
    color: "bg-purple-100 text-purple-700 border border-purple-200",
  },
};

const PRIORITY_CONFIG: Record<number, { label: string; color: string }> = {
  0: { label: "—", color: "text-gray-400" },
  1: { label: "低", color: "bg-blue-50 text-blue-700 border border-blue-200" },
  2: {
    label: "中",
    color: "bg-amber-50 text-amber-700 border border-amber-200",
  },
  3: {
    label: "高",
    color: "bg-orange-50 text-orange-700 border border-orange-200",
  },
  4: {
    label: "紧急",
    color: "bg-rose-50 text-rose-700 border border-rose-200",
  },
};

function truncate(str: string, max = 60) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function WorkItemRow({ item }: { item: MyWorkItem }) {
  const statusCfg = item.status ? STATUS_CONFIG[item.status] : null;
  const priorityCfg = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG[0];

  return (
    <Link
      href={`/work-items?project=${encodeURIComponent(item.project_id)}`}
      className="group flex items-center gap-3 px-5 py-3 transition-smooth hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 group-hover:text-indigo-700">
          {truncate(item.title || "(无标题)")}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {item.project_name && (
            <span className="rounded bg-secondary px-1.5 py-0.5 truncate max-w-[160px]">
              {item.project_name}
            </span>
          )}
          {item.assignee && (
            <span className="truncate max-w-[80px]">@{item.assignee}</span>
          )}
        </div>
      </div>
      {item.priority > 0 && (
        <span
          className={`shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priorityCfg.color}`}
        >
          {priorityCfg.label}
        </span>
      )}
      {statusCfg && (
        <span
          className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusCfg.color}`}
        >
          {statusCfg.label}
        </span>
      )}
    </Link>
  );
}

export function MyWorkItems() {
  const { data, isLoading, isError } = useMyWorkItems(4);
  const items = data ?? [];

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 shadow-sm backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-gray-200/60 px-5 py-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-sky-600" />
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            我的工作项
          </h2>
        </div>
        <Link
          href="/work-items"
          className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          查看全部 →
        </Link>
      </header>
      <div className="px-0 py-0">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">
            加载中...
          </div>
        ) : isError ? (
          <div className="py-10 text-center text-sm text-red-500">加载失败</div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            暂无待办工作项
          </div>
        ) : (
          <div className="divide-y divide-gray-200/60">
            {items.map((item) => (
              <WorkItemRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
