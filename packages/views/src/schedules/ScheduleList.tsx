"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Input } from "@tide/ui";
import {
  useSchedulesQuery,
  useToggleScheduleMutation,
  useDeleteScheduleMutation,
  useTriggerScheduleMutation,
} from "@tide/core";
import type { Schedule } from "@tide/core";

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

interface ScheduleListProps {
  items: Schedule[];
  onEdit?: (schedule: Schedule) => void;
}

export function ScheduleList({ items, onEdit }: ScheduleListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const toggleMutation = useToggleScheduleMutation();
  const deleteMutation = useDeleteScheduleMutation();
  const triggerMutation = useTriggerScheduleMutation();

  const filtered = items.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.cron_expr.includes(search)
  );

  if (items.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        暂无调度任务
      </div>
    );
  }

  return (
    <div>
      {/* Search */}
      <div className="mb-4">
        <Input
          placeholder="搜索名称或 Cron 表达式..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-3 font-medium">名称</th>
              <th className="px-3 py-3 font-medium">Cron</th>
              <th className="px-3 py-3 font-medium">状态</th>
              <th className="px-3 py-3 font-medium">下次执行</th>
              <th className="px-3 py-3 font-medium">上次执行</th>
              <th className="px-3 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((schedule) => (
              <tr
                key={schedule.id}
                className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                onClick={() => router.push(`/schedules/${schedule.id}`)}
              >
                <td className="px-3 py-3 font-medium">{schedule.name}</td>
                <td className="px-3 py-3 font-mono text-xs">
                  {schedule.cron_expr}
                </td>
                <td className="px-3 py-3">
                  <Badge
                    variant={schedule.enabled ? "default" : "secondary"}
                  >
                    {schedule.enabled ? "启用" : "停用"}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {formatTime(schedule.next_run_at)}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {formatTime(schedule.last_run_at)}
                </td>
                <td className="px-3 py-3">
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleMutation.mutate(schedule.id)}
                      disabled={toggleMutation.isPending}
                    >
                      {schedule.enabled ? "停用" : "启用"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => triggerMutation.mutate(schedule.id)}
                      disabled={triggerMutation.isPending}
                    >
                      触发
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit?.(schedule)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("确定删除该调度？")) {
                          deleteMutation.mutate(schedule.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && items.length > 0 && (
        <div className="py-8 text-center text-muted-foreground">
          无匹配结果
        </div>
      )}
    </div>
  );
}
