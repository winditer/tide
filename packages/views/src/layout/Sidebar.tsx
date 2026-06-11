"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@tide/ui";

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "工作台", href: "/", icon: "🏠" },
  { label: "项目", href: "/projects", icon: "📁" },
  { label: "任务", href: "/tasks", icon: "📋" },
  { label: "工作项", href: "/work-items", icon: "🎯" },
  { label: "计划", href: "/plans", icon: "📝" },
  { label: "看板", href: "/kanban", icon: "📊" },
  { label: "工作流", href: "/workflows", icon: "🔄" },
  { label: "定时", href: "/schedules", icon: "⏰" },
  { label: "会话", href: "/sessions", icon: "💬" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function Sidebar({ open, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
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
          "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r bg-card transition-all duration-200 lg:static lg:translate-x-0",
          // Mobile keeps full width regardless of collapsed state
          collapsed ? "w-56 lg:w-14" : "w-56",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex h-14 items-center gap-2 border-b",
            collapsed ? "px-0 lg:justify-center lg:px-2 px-4" : "px-4"
          )}
        >
          <span className="text-xl">🤖</span>
          <span
            className={cn(
              "text-base font-bold tracking-tight",
              collapsed && "lg:hidden"
            )}
          >
            Tide
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors",
                collapsed ? "px-2 lg:justify-center" : "px-3",
                isActive(pathname, item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <span className="text-base">{item.icon}</span>
              <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t p-3 space-y-1">
          <Link
            href="/settings"
            title={collapsed ? "设置" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
              collapsed ? "px-2 lg:justify-center" : "px-3"
            )}
          >
            <span className="text-base">⚙️</span>
            <span className={cn(collapsed && "lg:hidden")}>设置</span>
          </Link>

          {/* Collapse / expand toggle (desktop only) */}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? "展开侧边栏" : "收起侧边栏"}
              aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
              className={cn(
                "hidden lg:flex w-full items-center gap-3 rounded-md py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                collapsed ? "px-2 justify-center" : "px-3 justify-end"
              )}
            >
              <span className="text-base leading-none">
                {collapsed ? "»" : "«"}
              </span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
