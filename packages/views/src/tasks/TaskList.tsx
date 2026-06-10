"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@tide/ui";
import { Button } from "@tide/ui";
import type { Task, TaskStatus } from "@tide/core";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "secondary",
  running: "default",
  review: "outline",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  approved: "secondary",
  rejected: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  review: "待审批",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  approved: "已批准",
  rejected: "已拒绝",
};

function shortId(id: string) {
  return id.slice(0, 8);
}

function truncate(s: string | null, limit = 60) {
  if (!s) return "—";
  return s.length > limit ? s.slice(0, limit) + "…" : s;
}

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

interface TaskListProps {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function TaskList({
  items,
  total,
  page,
  pageSize,
  onPageChange,
}: TaskListProps) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (items.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        暂无任务
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-3 font-medium">ID</th>
              <th className="px-3 py-3 font-medium">Prompt</th>
              <th className="px-3 py-3 font-medium">Agent</th>
              <th className="px-3 py-3 font-medium">状态</th>
              <th className="px-3 py-3 font-medium">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((task) => (
              <tr
                key={task.id}
                className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                onClick={() => router.push(`/tasks/${task.id}`)}
              >
                <td className="px-3 py-3 font-mono text-xs">
                  {shortId(task.id)}
                </td>
                <td className="max-w-[300px] truncate px-3 py-3">
                  {truncate(task.prompt)}
                </td>
                <td className="px-3 py-3">{task.agent_id || "—"}</td>
                <td className="px-3 py-3">
                  <Badge variant={STATUS_VARIANT[task.status] ?? "outline"}>
                    {STATUS_LABEL[task.status] ?? task.status}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {formatTime(task.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-4">
          <span className="text-sm text-muted-foreground">
            共 {total} 条，第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
