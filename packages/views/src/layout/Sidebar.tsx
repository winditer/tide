"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@lark2codex/ui";

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "工作台", href: "/", icon: "🏠" },
  { label: "任务", href: "/tasks", icon: "📋" },
  { label: "Plan", href: "/plans", icon: "📝" },
  { label: "看板", href: "/kanban", icon: "📊" },
  { label: "工作流", href: "/workflows", icon: "🔄" },
  { label: "定时", href: "/schedules", icon: "⏰" },
  { label: "项目", href: "/projects", icon: "📁" },
  { label: "会话", href: "/sessions", icon: "💬" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 flex-col border-r bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <span className="text-xl">🤖</span>
          <span className="text-base font-bold tracking-tight">Lark2Agent</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(pathname, item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t p-3">
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <span className="text-base">⚙️</span>
            <span>设置</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
