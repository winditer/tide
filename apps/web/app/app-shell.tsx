"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Header } from "@tide/views/layout/Header";
import { Sidebar } from "@tide/views/layout/Sidebar";
import { FloatingChat } from "@tide/views/dashboard/FloatingChat";
import { useAuth, useWs } from "@tide/core";
import { toast } from "@tide/ui";

/**
 * Top-level shell.
 *
 * - Routes under `/auth/*` are rendered chrome-free (no sidebar/header) so
 *   the login page can fully control its visual.
 * - When TIDE_REQUIRE_AUTH is enforced and the user is not authenticated,
 *   redirects to `/auth/login` (preserving the original target via `?redirect=`).
 * - The `useAuth` call here also boots the API client auth bridge for the
 *   whole app, so every downstream `apiClient` request gets the bearer header.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { isAuthenticated, hydrated, authRequired, user } = useAuth();

  const isAuthRoute = pathname.startsWith("/auth");
  const { subscribe } = useWs();

  useEffect(() => {
    if (!hydrated) return;
    if (!authRequired) return;
    if (isAuthenticated) return;
    if (isAuthRoute) return;
    const redirect = encodeURIComponent(pathname);
    router.replace(`/auth/login?redirect=${redirect}`);
  }, [hydrated, authRequired, isAuthenticated, isAuthRoute, pathname, router]);

  // Surface security.alert WS events as global toasts so users notice high-severity
  // findings immediately, even when the Security page is not open.
  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "security.alert") return;
      const evt = event as unknown as { task_id?: string; count?: number };
      const count = evt.count ?? 0;
      const taskId = evt.task_id ?? "";
      toast({
        title: `安全告警：发现 ${count} 个高危问题`,
        description: taskId
          ? `任务 ${taskId.slice(0, 8)}… 的输出触发了安全规则`
          : "Agent 输出触发了安全规则",
        variant: "destructive",
      });
    });
  }, [subscribe]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Settings is admin-only when auth is enforced; in single-user / no-auth
  // mode we keep the entry visible (the page itself still gates each item).
  const canShowSettings = authRequired ? user?.role === "admin" : true;

  if (isAuthRoute) {
    return <>{children}</>;
  }

  // Pre-hydration: when auth is enforced we cannot yet know whether the user
  // holds a valid token (persisted state lives in localStorage and is only
  // restored on the client). Render a neutral loading shell so the protected
  // UI never flashes before the redirect / auth decision is made.
  if (authRequired && !hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/70"
        />
      </div>
    );
  }

  // Post-hydration but unauthenticated: the redirect effect above is in flight,
  // render an empty canvas to avoid showing the protected UI for a frame.
  if (authRequired && hydrated && !isAuthenticated) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        showSettings={canShowSettings}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
        <main className="flex-1 overflow-auto bg-background">
          <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>
      <FloatingChat />
    </div>
  );
}
