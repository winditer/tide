"use client";

import { AgentPanel } from "@tide/views/dashboard/AgentPanel";
import { QuickInput } from "@tide/views/dashboard/QuickInput";
import { RecentTasks } from "@tide/views/dashboard/RecentTasks";
import { StatCards } from "@tide/views/dashboard/StatCards";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">工作台</h1>
      <StatCards />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentTasks />
        </div>
        <div>
          <AgentPanel />
        </div>
      </div>
      <QuickInput />
    </div>
  );
}
