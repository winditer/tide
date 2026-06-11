"use client";

import Link from "next/link";
import {
  Plus,
  MessageSquarePlus,
  FolderPlus,
  FilePlus,
  CalendarPlus,
  type LucideIcon,
} from "lucide-react";

interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  hoverBorder: string;
  hoverBg: string;
  hoverText: string;
}

const ACTIONS: QuickAction[] = [
  {
    label: "创建任务",
    href: "/tasks?action=create",
    icon: Plus,
    iconBg: "bg-indigo-50",
    iconColor: "text-indigo-600",
    hoverBorder: "hover:border-indigo-200",
    hoverBg: "hover:bg-indigo-50/60",
    hoverText: "hover:text-indigo-700",
  },
  {
    label: "创建会话",
    href: "/sessions?action=create",
    icon: MessageSquarePlus,
    iconBg: "bg-sky-50",
    iconColor: "text-sky-600",
    hoverBorder: "hover:border-sky-200",
    hoverBg: "hover:bg-sky-50/60",
    hoverText: "hover:text-sky-700",
  },
  {
    label: "创建项目",
    href: "/projects?action=create",
    icon: FolderPlus,
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    hoverBorder: "hover:border-violet-200",
    hoverBg: "hover:bg-violet-50/60",
    hoverText: "hover:text-violet-700",
  },
  {
    label: "创建计划",
    href: "/plans?action=create",
    icon: FilePlus,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    hoverBorder: "hover:border-emerald-200",
    hoverBg: "hover:bg-emerald-50/60",
    hoverText: "hover:text-emerald-700",
  },
  {
    label: "创建定时任务",
    href: "/schedules?action=create",
    icon: CalendarPlus,
    iconBg: "bg-orange-50",
    iconColor: "text-orange-600",
    hoverBorder: "hover:border-orange-200",
    hoverBg: "hover:bg-orange-50/60",
    hoverText: "hover:text-orange-700",
  },
];

export function QuickActions() {
  return (
    <nav aria-label="快速入口" className="flex flex-wrap items-center gap-2">
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.href}
            href={action.href}
            className={`group inline-flex cursor-pointer items-center gap-2 rounded-xl border border-transparent bg-white/80 px-3 py-2 text-sm font-medium text-gray-700 shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${action.hoverBorder} ${action.hoverBg} ${action.hoverText}`}
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-lg ${action.iconBg} ${action.iconColor} transition-transform duration-200 group-hover:scale-110`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span>{action.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
