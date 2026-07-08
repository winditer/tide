"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Popover, PopoverTrigger, PopoverContent } from "@tide/ui";
import {
  useUnreadCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllRead,
  type Notification,
} from "@tide/core";

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: countData } = useUnreadCount();
  const { data: notifData } = useNotifications(true); // unread only
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllRead();

  const count = countData?.count ?? 0;
  const notifications = notifData?.items ?? [];

  const handleClick = (n: Notification) => {
    markRead.mutate(n.id);
    if (n.notification_type === "project_added") {
      router.push(`/projects`);
    } else {
      router.push(`/work-items?detail=${n.work_item_id}`);
    }
    setOpen(false);
  };

  const handleMarkAll = () => {
    markAllRead.mutate();
  };

  // 通知类型图标/颜色映射
  const typeConfig: Record<string, { label: string; color: string }> = {
    assigned: { label: "分配", color: "text-blue-600" },
    completed: { label: "完成", color: "text-emerald-600" },
    mentioned: { label: "提及", color: "text-amber-600" },
    task_completed: { label: "任务完成", color: "text-purple-600" },
    approved: { label: "通过", color: "text-green-600" },
    rejected: { label: "拒绝", color: "text-red-600" },
    cancelled: { label: "取消", color: "text-zinc-500" },
    project_added: { label: "项目", color: "text-indigo-600" },
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">通知</span>
          {count > 0 && (
            <button
              onClick={handleMarkAll}
              className="text-xs text-primary hover:underline"
            >
              全部已读
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              暂无新通知
            </div>
          ) : (
            notifications.slice(0, 10).map((n) => {
              const config = typeConfig[n.notification_type] || {
                label: "通知",
                color: "text-zinc-600",
              };
              return (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="flex cursor-pointer items-start gap-3 border-b border-border/50 px-4 py-3 transition-colors hover:bg-accent/50 last:border-0"
                >
                  <div
                    className={`mt-0.5 shrink-0 text-[10px] font-semibold ${config.color}`}
                  >
                    {config.label}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-foreground line-clamp-2">
                      {n.content}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatTime(n.created_at)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return d.toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
