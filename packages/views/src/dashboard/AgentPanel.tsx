"use client";

import { Bot } from "lucide-react";
import { useAgents } from "@tide/core";

export function AgentPanel() {
  const { data, isLoading, isError } = useAgents();
  const agents = data?.agents ?? [];

  return (
    <section className="rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            Agent 状态
          </h2>
        </div>
        {agents.length > 0 && (
          <span className="text-xs text-gray-400">共 {agents.length}</span>
        )}
      </header>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-gray-400">加载中...</div>
      ) : isError ? (
        <div className="py-6 text-center text-sm text-red-500">加载失败</div>
      ) : agents.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">暂无 Agent</div>
      ) : (
        <ul className="space-y-1.5">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-indigo-50/60"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`relative inline-flex h-2 w-2 shrink-0`}
                >
                  {agent.available ? (
                    <>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </>
                  ) : (
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-gray-300" />
                  )}
                </span>
                <span className="truncate text-sm font-medium text-gray-900">
                  {agent.name}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-xs">
                {agent.running_tasks > 0 && (
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
                    {agent.running_tasks} 运行
                  </span>
                )}
                {agent.queued_tasks > 0 && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                    {agent.queued_tasks} 排队
                  </span>
                )}
                {agent.running_tasks === 0 && agent.queued_tasks === 0 && (
                  <span className="text-gray-400">空闲</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
