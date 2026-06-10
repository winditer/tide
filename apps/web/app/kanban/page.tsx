"use client";

import { useState } from "react";
import { Button } from "@tide/ui";
import {
  ProjectBoard,
  SessionBoard,
  AgentBoard,
  WorkflowBoard,
} from "@tide/views";

type TabKey = "projects" | "sessions" | "agents" | "workflows";

const TABS: { key: TabKey; label: string }[] = [
  { key: "projects", label: "项目" },
  { key: "sessions", label: "会话" },
  { key: "agents", label: "Agent" },
  { key: "workflows", label: "工作流" },
];

export default function KanbanPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("projects");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">看板</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.key)}
            className="flex-1"
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Board content */}
      <div>
        {activeTab === "projects" && <ProjectBoard />}
        {activeTab === "sessions" && <SessionBoard />}
        {activeTab === "agents" && <AgentBoard />}
        {activeTab === "workflows" && <WorkflowBoard />}
      </div>
    </div>
  );
}
