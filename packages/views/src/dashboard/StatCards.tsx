"use client";

import { Card, CardContent } from "@lark2codex/ui";
import { useDashboardStats } from "@lark2codex/core";

const STATS = [
  { key: "running" as const, label: "运行中", icon: "⚡", color: "text-blue-600" },
  { key: "queued" as const, label: "排队中", icon: "⏳", color: "text-yellow-600" },
  { key: "pending_approval" as const, label: "待审批", icon: "🔔", color: "text-orange-600" },
  { key: "completed_today" as const, label: "今日完成", icon: "✅", color: "text-green-600" },
];

export function StatCards() {
  const { data, isLoading } = useDashboardStats();

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {STATS.map((stat) => (
        <Card key={stat.key}>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="text-2xl">{stat.icon}</span>
            <div>
              <p className={`text-2xl font-bold ${stat.color}`}>
                {isLoading ? "—" : (data?.[stat.key] ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
