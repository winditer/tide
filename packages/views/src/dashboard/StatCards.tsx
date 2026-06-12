"use client";

import Link from "next/link";
import {
  Zap,
  Hourglass,
  BellRing,
  CheckCircle2,
  ClipboardList,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";
import { useDashboardStats } from "@tide/core";

type StatKey =
  | "running"
  | "queued"
  | "pending_approval"
  | "completed_today"
  | "my_work_items_count"
  | "weekly_completed_work_items";

interface StatItem {
  key: StatKey;
  label: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
}

const STATS: StatItem[] = [
  {
    key: "running",
    label: "运行中",
    href: "/tasks?status=running",
    icon: Zap,
    accent: "bg-indigo-500",
    iconBg: "bg-indigo-50",
    iconColor: "text-indigo-600",
    valueColor: "text-indigo-600",
  },
  {
    key: "queued",
    label: "排队中",
    href: "/tasks?status=queued",
    icon: Hourglass,
    accent: "bg-amber-500",
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    valueColor: "text-amber-600",
  },
  {
    key: "pending_approval",
    label: "待审批",
    href: "/tasks?status=pending_approval",
    icon: BellRing,
    accent: "bg-orange-500",
    iconBg: "bg-orange-50",
    iconColor: "text-orange-600",
    valueColor: "text-orange-600",
  },
  {
    key: "completed_today",
    label: "今日完成",
    href: "/tasks?status=completed",
    icon: CheckCircle2,
    accent: "bg-emerald-500",
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    valueColor: "text-emerald-600",
  },
  {
    key: "my_work_items_count",
    label: "我的待办",
    href: "/work-items",
    icon: ClipboardList,
    accent: "bg-sky-500",
    iconBg: "bg-sky-50",
    iconColor: "text-sky-600",
    valueColor: "text-sky-600",
  },
  {
    key: "weekly_completed_work_items",
    label: "本周完成",
    href: "/work-items?status=completed",
    icon: CheckCheck,
    accent: "bg-teal-500",
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
    valueColor: "text-teal-600",
  },
];

export function StatCards() {
  const { data, isLoading } = useDashboardStats();

  const getValue = (key: StatItem["key"]): number | undefined => {
    return data?.[key];
  };
  const getLoading = (_key: StatItem["key"]): boolean => isLoading;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {STATS.map((stat) => {
        const Icon = stat.icon;
        const value = getValue(stat.key);
        const loading = getLoading(stat.key);
        return (
          <Link
            key={stat.key}
            href={stat.href}
            className="group relative block cursor-pointer overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <span
              aria-hidden
              className={`absolute inset-x-0 top-0 h-1 ${stat.accent}`}
            />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs font-medium text-gray-500">
                  {stat.label}
                </p>
                <p
                  className={`text-2xl font-semibold tracking-tight tabular-nums ${stat.valueColor}`}
                >
                  {loading ? "—" : (value ?? 0)}
                </p>
              </div>
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${stat.iconBg} ${stat.iconColor} transition-transform duration-200 group-hover:scale-110`}
              >
                <Icon className="h-4 w-4" />
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
