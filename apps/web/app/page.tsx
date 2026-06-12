"use client";

import { ActiveProjects } from "@tide/views/dashboard/ActiveProjects";
import { ActivityTimeline } from "@tide/views/dashboard/ActivityTimeline";
import { AgentPanel } from "@tide/views/dashboard/AgentPanel";
import { MyWorkItems } from "@tide/views/dashboard/MyWorkItems";
import { ProjectProgress } from "@tide/views/dashboard/ProjectProgress";
import { QuickActions } from "@tide/views/dashboard/QuickActions";
import { RecentTasks } from "@tide/views/dashboard/RecentTasks";
import { StatCards } from "@tide/views/dashboard/StatCards";
import { TaskStatusChart } from "@tide/views/dashboard/TaskStatusChart";
import { UpcomingSchedules } from "@tide/views/dashboard/UpcomingSchedules";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            工作台
          </h1>
          <p className="text-sm text-gray-500">
            欢迎回来，统一掌握运行中、待审批与最近任务的最新动态。
          </p>
        </div>
        <QuickActions />
      </header>

      <StatCards />

      {/* 工作项概览：我的待办（左 2/3） + 项目进度（右 1/3） */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 max-h-[460px] overflow-y-auto">
          <MyWorkItems />
        </div>
        <ProjectProgress />
      </div>

      {/* 上半区：三列等宽 —— 任务状态分布 / Agent 状态 / 活跃项目 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <TaskStatusChart />
        <AgentPanel />
        <ActiveProjects />
      </div>

      {/* 即将执行：全宽 */}
      <UpcomingSchedules />

      {/* 下半区：左右各半 —— 活动时间线 + 最近任务（统一限高滚动） */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="max-h-[500px] overflow-y-auto">
          <ActivityTimeline />
        </div>
        <div className="max-h-[500px] overflow-y-auto">
          <RecentTasks />
        </div>
      </div>
    </div>
  );
}
