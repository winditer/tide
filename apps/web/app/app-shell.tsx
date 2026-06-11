"use client";

import { useState } from "react";
import { Header } from "@tide/views/layout/Header";
import { Sidebar } from "@tide/views/layout/Sidebar";
import { FloatingChat } from "@tide/views/dashboard/FloatingChat";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
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
