"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Menu,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  UserRound,
  ShieldCheck,
} from "lucide-react";
import {
  ConnectionStatus,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@tide/ui";
import { useWs, useAuth } from "@tide/core";

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

      {/* Right: Connection + Settings + User */}
      <div className="flex items-center gap-3">
        <ConnectionStatus status={status} />
        <div className="hidden h-5 w-px bg-border/60 lg:block" />
        <Link
          href="/settings"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-accent hover:text-foreground"
          aria-label="设置"
        >
          <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}

/**
 * Header user dropdown.
 *
 * Shows the current display name + role with a small avatar disc; opens a
 * menu containing profile shortcut and a logout action. When TIDE_REQUIRE_AUTH
 * is off and the user hasn't logged in, surfaces a "登录" entry instead.
 */
function UserMenu() {
  const router = useRouter();
  const { user, isAuthenticated, authRequired, logout, hydrated } = useAuth();

  // Avoid SSR/CSR flicker before hydration
  if (!hydrated) {
    return <div className="h-8 w-24 rounded-md bg-muted/40" aria-hidden />;
  }

  if (!isAuthenticated) {
    return (
      <Link
        href="/auth/login"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background px-3 text-xs font-medium text-foreground/80 transition-smooth hover:border-primary hover:text-primary"
      >
        <UserRound className="h-3.5 w-3.5" strokeWidth={2} />
        {authRequired ? "登录" : "未登录"}
      </Link>
    );
  }

  const display = user?.display_name || user?.username || "用户";
  const initial = display.trim().charAt(0).toUpperCase() || "U";
  const role = user?.role || "member";

  const handleLogout = async () => {
    await logout();
    if (authRequired) {
      router.replace("/auth/login");
    } else {
      router.refresh();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background pl-1 pr-3 transition-smooth hover:border-primary/50 hover:bg-accent"
          aria-label="用户菜单"
        >
          <span
            className="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
            aria-hidden
          >
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initial
            )}
          </span>
          <span className="hidden text-xs font-medium text-foreground sm:inline">
            {display}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="text-sm font-semibold leading-tight">{display}</span>
          <span className="text-xs font-normal text-muted-foreground">
            @{user?.username}
          </span>
          <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-primary">
            <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
            {role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings className="mr-2 h-4 w-4" strokeWidth={2} /> 设置
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void handleLogout();
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" strokeWidth={2} /> 登出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
