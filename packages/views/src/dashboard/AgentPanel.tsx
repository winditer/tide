"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@lark2codex/ui";
import { useAgents } from "@lark2codex/core";

export function AgentPanel() {
  const { data, isLoading, isError } = useAgents();
  const agents = data?.agents ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agent 状态</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">加载中...</div>
        ) : isError ? (
          <div className="py-6 text-center text-sm text-destructive">加载失败</div>
        ) : agents.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">暂无 Agent</div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <div key={agent.id} className="flex items-center justify-between rounded-md px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      agent.available ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />
                  <span className="text-sm font-medium">{agent.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {agent.running_tasks > 0 && (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                      {agent.running_tasks} 运行
                    </span>
                  )}
                  {agent.queued_tasks > 0 && (
                    <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-700">
                      {agent.queued_tasks} 排队
                    </span>
                  )}
                  {agent.running_tasks === 0 && agent.queued_tasks === 0 && (
                    <span>空闲</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
