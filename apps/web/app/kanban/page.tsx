"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@tide/ui";
import { ProjectBoard, SessionBoard, AgentBoard } from "@tide/views";

type TabKey = "projects" | "sessions" | "agents";

const TABS: { key: TabKey; label: string }[] = [
  { key: "projects", label: "项目" },
  { key: "sessions", label: "会话" },
  { key: "agents", label: "Agent" },
];

export default function KanbanPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("projects");

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">看板</h1>
        <p className="text-sm text-muted-foreground mt-1">
          按项目、会话与 Agent 维度可视化地查看任务流转。
        </p>
      </header>

      {/* Tab bar */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabKey)}
      >
        <TabsList className="w-full">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} className="flex-1 transition-smooth">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Board content */}
        <div className="mt-8 rounded-2xl border border-border/60 bg-card/40 p-4 shadow-card">
          {activeTab === "projects" && <ProjectBoard />}
          {activeTab === "sessions" && <SessionBoard />}
          {activeTab === "agents" && <AgentBoard />}
        </div>
      </Tabs>
    </div>
  );
}
