"use client";

import Link from "next/link";
import { Menu, Settings, ChevronsLeft, ChevronsRight } from "lucide-react";
import { ConnectionStatus, Button } from "@tide/ui";
import { useWs } from "@tide/core";

interface HeaderProps {
  onMenuClick: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Header({ onMenuClick, collapsed = false, onToggleCollapse }: HeaderProps) {
  const { status } = useWs();

  return (
    <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-border/50 px-5">
      {/* Left: Hamburger (mobile) + collapse toggle (desktop) + brand (mobile) */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
          aria-label="打开导航"
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
        </Button>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            className="hidden lg:flex w-8 h-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth"
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" strokeWidth={2} />
            ) : (
              <ChevronsLeft className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        )}
        <span className="ml-1 text-sm font-semibold tracking-tight lg:hidden">Tide</span>
      </div>

      {/* Right: Connection + Settings */}
      <div className="flex items-center gap-4">
        <ConnectionStatus status={status} />
        <div className="hidden h-5 w-px bg-border/60 lg:block" />
        <Link
          href="/settings"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-accent hover:text-foreground"
          aria-label="设置"
        >
          <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
        </Link>
      </div>
    </header>
  );
}
