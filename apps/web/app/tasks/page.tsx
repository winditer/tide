"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@tide/ui";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tide/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@tide/ui";
import { useTasksQuery } from "@tide/core";
import {
  TaskList,
  TaskCreateForm,
  TaskFilters,
  type TaskFiltersValue,
} from "@tide/views";

const FILTER_KEYS: (keyof TaskFiltersValue)[] = [
  "status",
  "agent_id",
  "project",
  "session_id",
  "created_after",
  "created_before",
];

/**
 * 工作台“待审批”卡片链接到 ``/tasks?status=pending_approval``，但实际
 * 数据库中代表“待人工确认”的状态值是 ``review``（详见 TaskFilters
 * 的 STATUS_OPTIONS）。这里在解析 URL 时做一次别名映射，保证跳转后
 * 状态筛选生效。
 */
const STATUS_ALIASES: Record<string, string> = {
  pending_approval: "review",
};

function readFiltersFromParams(params: URLSearchParams): TaskFiltersValue {
  const out: TaskFiltersValue = {};
  for (const key of FILTER_KEYS) {
    const v = params.get(key);
    if (!v) continue;
    if (key === "status" && STATUS_ALIASES[v]) {
      out[key] = STATUS_ALIASES[v];
    } else {
      out[key] = v;
    }
  }
  return out;
}

function readPageFromParams(params: URLSearchParams): number {
  const p = Number(params.get("page"));
  return Number.isFinite(p) && p >= 1 ? p : 1;
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-8 text-center text-muted-foreground">加载中...</div>}>
      <TasksPageContent />
    </Suspense>
  );
}

function TasksPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 初始值从 URL 读取
  const initialFilters = useMemo(
    () => readFiltersFromParams(new URLSearchParams(searchParams.toString())),
    // 仅取一次，后续变化由本组件 push 到 URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const initialPage = useMemo(
    () => readPageFromParams(new URLSearchParams(searchParams.toString())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [filters, setFilters] = useState<TaskFiltersValue>(initialFilters);
  const [page, setPage] = useState(initialPage);
  const initialAction = useMemo(
    () => searchParams.get("action"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [showCreateDialog, setShowCreateDialog] = useState(
    initialAction === "create",
  );

  // debounce filters → debouncedFilters
  const [debouncedFilters, setDebouncedFilters] =
    useState<TaskFiltersValue>(initialFilters);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [filters]);

  // 同步 URL（防抖后的筛选 + 当前页）
  useEffect(() => {
    const sp = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const v = debouncedFilters[key];
      if (v) sp.set(key, v);
    }
    if (page > 1) sp.set("page", String(page));
    const qs = sp.toString();
    router.replace(qs ? `/tasks?${qs}` : "/tasks", { scroll: false });
  }, [debouncedFilters, page, router]);

  const { data, isLoading, isError } = useTasksQuery({
    ...debouncedFilters,
    page,
    page_size: 20,
  });

  const handleFiltersChange = (next: TaskFiltersValue) => {
    setFilters(next);
    setPage(1); // 筛选变化重置到第 1 页
  };

  const handleReset = () => {
    setFilters({});
    setPage(1);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">任务管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            查看、创建和管理 Agent 任务
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>+ 创建任务</Button>
      </div>

      {/* Filters */}
      <TaskFilters
        value={filters}
        onChange={handleFiltersChange}
        onReset={handleReset}
      />

      {/* Task List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">任务列表</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">
              加载中...
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-destructive">
              加载失败，请重试
            </div>
          ) : (
            <TaskList
              items={data?.items ?? []}
              total={data?.total ?? 0}
              page={data?.page ?? 1}
              pageSize={data?.page_size ?? 20}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Task Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建任务</DialogTitle>
          </DialogHeader>
          <TaskCreateForm onSuccess={() => setShowCreateDialog(false)} />
        </DialogContent>
      </Dialog>
    </main>
  );
}
