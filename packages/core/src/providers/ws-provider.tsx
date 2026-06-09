"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TaskEvent } from "../types/task";

type WsStatus = "connecting" | "connected" | "disconnected";

interface WsContextValue {
  status: WsStatus;
  lastEvent: TaskEvent | null;
  subscribe: (handler: (event: TaskEvent) => void) => () => void;
}

const WsContext = createContext<WsContextValue | null>(null);

export function useWs(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) {
    throw new Error("useWs must be used within a WsProvider");
  }
  return ctx;
}

export { WsContext };

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws";

const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 10_000;
const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

/**
 * 处理 WS 事件 → TanStack Query invalidation
 */
function handleWsEvent(event: TaskEvent, queryClient: ReturnType<typeof useQueryClient>) {
  switch (event.type) {
    case "task.created":
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      break;
    case "task.status_changed":
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", event.task_id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      break;
    case "task.output":
      queryClient.invalidateQueries({ queryKey: ["task", event.task_id] });
      break;
    case "approval.requested":
    case "approval.resolved":
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      break;
    default:
      // Unknown event type — no invalidation
      break;
  }
}

export function WsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [lastEvent, setLastEvent] = useState<TaskEvent | null>(null);
  const handlersRef = useRef<Set<(event: TaskEvent) => void>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const mountedRef = useRef(true);
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    heartbeatTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
        heartbeatTimeoutRef.current = setTimeout(() => {
          ws.close();
        }, HEARTBEAT_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      startHeartbeat();
      // Subscribe to default channels after connecting
      ws.send(JSON.stringify({ type: "subscribe", channels: ["tasks", "approvals"] }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;

      try {
        const data = JSON.parse(event.data as string) as TaskEvent | { type: "pong" };

        if ("type" in data && data.type === "pong") {
          if (heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
            heartbeatTimeoutRef.current = null;
          }
          return;
        }

        const taskEvent = data as TaskEvent;
        setLastEvent(taskEvent);
        // TanStack Query invalidation
        handleWsEvent(taskEvent, queryClientRef.current);
        // Notify custom handlers
        handlersRef.current.forEach((handler) => {
          try {
            handler(taskEvent);
          } catch {
            // handler error — swallow
          }
        });
      } catch {
        // invalid message — swallow
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus("disconnected");
      clearTimers();
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, [clearTimers, startHeartbeat]);

  const subscribe = useCallback((handler: (event: TaskEvent) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearTimers]);

  const contextValue = useMemo(
    () => ({ status, lastEvent, subscribe }),
    [status, lastEvent, subscribe],
  );

  return (
    <WsContext.Provider value={contextValue}>
      {children}
    </WsContext.Provider>
  );
}