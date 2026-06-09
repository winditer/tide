"use client";
var _a;
import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, } from "react";
import { useQueryClient } from "@tanstack/react-query";
const WsContext = createContext(null);
export function useWs() {
    const ctx = useContext(WsContext);
    if (!ctx) {
        throw new Error("useWs must be used within a WsProvider");
    }
    return ctx;
}
export { WsContext };
const WS_URL = (_a = process.env.NEXT_PUBLIC_WS_URL) !== null && _a !== void 0 ? _a : "ws://localhost:8000/ws";
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 10000;
const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;
/**
 * 处理 WS 事件 → TanStack Query invalidation
 */
function handleWsEvent(event, queryClient) {
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
export function WsProvider({ children }) {
    const queryClient = useQueryClient();
    const [status, setStatus] = useState("disconnected");
    const [lastEvent, setLastEvent] = useState(null);
    const handlersRef = useRef(new Set());
    const wsRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const heartbeatTimerRef = useRef(null);
    const heartbeatTimeoutRef = useRef(null);
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
        if (!mountedRef.current)
            return;
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        setStatus("connecting");
        ws.onopen = () => {
            if (!mountedRef.current)
                return;
            setStatus("connected");
            reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
            startHeartbeat();
            // Subscribe to default channels after connecting
            ws.send(JSON.stringify({ type: "subscribe", channels: ["tasks", "approvals"] }));
        };
        ws.onmessage = (event) => {
            if (!mountedRef.current)
                return;
            try {
                const data = JSON.parse(event.data);
                if ("type" in data && data.type === "pong") {
                    if (heartbeatTimeoutRef.current) {
                        clearTimeout(heartbeatTimeoutRef.current);
                        heartbeatTimeoutRef.current = null;
                    }
                    return;
                }
                const taskEvent = data;
                setLastEvent(taskEvent);
                // TanStack Query invalidation
                handleWsEvent(taskEvent, queryClientRef.current);
                // Notify custom handlers
                handlersRef.current.forEach((handler) => {
                    try {
                        handler(taskEvent);
                    }
                    catch (_a) {
                        // handler error — swallow
                    }
                });
            }
            catch (_a) {
                // invalid message — swallow
            }
        };
        ws.onclose = () => {
            if (!mountedRef.current)
                return;
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
    const subscribe = useCallback((handler) => {
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
    const contextValue = useMemo(() => ({ status, lastEvent, subscribe }), [status, lastEvent, subscribe]);
    return (_jsx(WsContext.Provider, { value: contextValue, children: children }));
}
//# sourceMappingURL=ws-provider.js.map