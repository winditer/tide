"use client";

import { useState } from "react";
import { Header } from "@tide/views/layout/Header";
import { Sidebar } from "@tide/views/layout/Sidebar";
import { FloatingChat } from "@tide/views/dashboard/FloatingChat";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <FloatingChat />
    </div>
  );
}
