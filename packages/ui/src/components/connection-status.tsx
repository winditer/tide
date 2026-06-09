"use client";

import { cn } from "../lib/utils";

type WsStatus = "connecting" | "connected" | "disconnected";

export interface ConnectionStatusProps {
  status: WsStatus;
  className?: string;
}

const statusConfig: Record<WsStatus, { dot: string; label: string; pulse: string }> = {
  connected: {
    dot: "bg-green-500",
    label: "已连接",
    pulse: "animate-pulse",
  },
  connecting: {
    dot: "bg-yellow-500",
    label: "连接中...",
    pulse: "animate-pulse",
  },
  disconnected: {
    dot: "bg-red-500",
    label: "已断开",
    pulse: "",
  },
};

export function ConnectionStatus({ status, className }: ConnectionStatusProps) {
  const config = statusConfig[status];

  return (
    <div className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          config.dot,
          config.pulse,
        )}
      />
      <span>{config.label}</span>
    </div>
  );
}