"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTask } from "../api/tasks";
import { getTask } from "../api/tasks";
import { useWs } from "../providers/ws-provider";
import type { TaskEvent } from "../types/task";

export type ChatMessageStatus = "pending" | "running" | "completed" | "failed";
export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  /** ISO string for serialization safety; rendered components should parse */
  timestamp: string;
  taskId?: string;
  status?: ChatMessageStatus;
}

export interface UseChatOptions {
  projectId?: string;
  sessionId?: string;
  agentId?: string;
}

const STORAGE_PREFIX = "tide.chat.history.";
const HISTORY_LIMIT = 200;
const CONTEXT_WINDOW = 10;
const CONTEXT_PER_MESSAGE_CHARS = 200;

function storageKey(projectId?: string): string {
  return `${STORAGE_PREFIX}${projectId || "_global_"}`;
}

function loadFromStorage(projectId?: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is ChatMessage => !!m && typeof m.id === "string")
      .map((m) => ({
        ...m,
        // Status pending/running is ephemeral; treat as failed if recovered after reload
        status:
          m.status === "running" || m.status === "pending"
            ? "failed"
            : m.status,
      }));
  } catch {
    return [];
  }
}

function saveToStorage(projectId: string | undefined, messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const slice = messages.slice(-HISTORY_LIMIT);
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(slice));
  } catch {
    // quota exceeded — ignore
  }
}

function genId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof (crypto as Crypto & { randomUUID?: () => string }).randomUUID ===
      "function"
  ) {
    return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildContextPrompt(
  messages: ChatMessage[],
  newContent: string
): string {
  const recent = messages.slice(-CONTEXT_WINDOW);
  if (recent.length === 0) return newContent;
  const recentHistory = recent
    .map(
      (m) =>
        `[${m.role}]: ${(m.content || "").slice(0, CONTEXT_PER_MESSAGE_CHARS)}`
    )
    .join("\n");
  return `## 对话上下文\n${recentHistory}\n\n## 当前请求\n${newContent}`;
}

export interface SendMessageOverrides {
  projectCwd?: string;
  sessionId?: string;
  agentId?: string;
}

export interface UseChatResult {
  messages: ChatMessage[];
  isSending: boolean;
  hasUnread: boolean;
  markRead: () => void;
  sendMessage: (
    content: string,
    overrides?: SendMessageOverrides
  ) => Promise<void>;
  clearHistory: () => void;
}

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { projectId, sessionId, agentId } = options;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const hydratedKeyRef = useRef<string | null>(null);

  const { subscribe } = useWs();

  // Hydrate from localStorage when projectId changes
  useEffect(() => {
    const key = storageKey(projectId);
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    const stored = loadFromStorage(projectId);
    setMessages(stored);
  }, [projectId]);

  // Persist on every change
  useEffect(() => {
    if (hydratedKeyRef.current !== storageKey(projectId)) return;
    saveToStorage(projectId, messages);
  }, [messages, projectId]);

  const updateAssistantFromTask = useCallback(async (taskId: string) => {
    try {
      const task = await getTask(taskId);
      const status = String(task.status || "").toLowerCase();
      const finalStatus: ChatMessageStatus | undefined =
        status === "completed" || status === "approved"
          ? "completed"
          : status === "failed" ||
              status === "rejected" ||
              status === "stopped"
            ? "failed"
            : status === "running" || status === "queued"
              ? "running"
              : undefined;
      const result = (task.result || "").toString();
      setMessages((prev) =>
        prev.map((m) => {
          if (m.taskId !== taskId || m.role !== "assistant") return m;
          const next: ChatMessage = {
            ...m,
            status: finalStatus ?? m.status,
          };
          if (finalStatus === "completed") {
            next.content = result || "(任务已完成，无输出)";
          } else if (finalStatus === "failed") {
            next.content = result || "(任务执行失败)";
          }
          return next;
        })
      );
      if (finalStatus === "completed" || finalStatus === "failed") {
        setHasUnread(true);
      }
    } catch {
      // network failure — keep message in running state
    }
  }, []);

  // Subscribe to WS events to update messages
  useEffect(() => {
    const handler = (event: TaskEvent) => {
      if (!event || !event.task_id) return;
      const trackedTaskIds = new Set(
        messagesRef.current
          .filter((m) => m.role === "assistant" && m.taskId)
          .map((m) => m.taskId as string)
      );
      if (!trackedTaskIds.has(event.task_id)) return;

      const type = event.type;
      // Backend emits "task.status_changed" with new_status; some flows may emit
      // shorthand "task.completed" / "task.failed". Handle both.
      if (
        type === "task.completed" ||
        type === "task.failed" ||
        type === "task.status_changed"
      ) {
        const raw = event as TaskEvent & {
          new_status?: string;
          payload?: Record<string, unknown>;
        };
        const ns = (
          raw.new_status ||
          (raw.payload?.new_status as string | undefined) ||
          (type === "task.completed"
            ? "completed"
            : type === "task.failed"
              ? "failed"
              : "")
        )
          .toString()
          .toLowerCase();
        if (
          ns === "completed" ||
          ns === "failed" ||
          ns === "stopped" ||
          ns === "approved" ||
          ns === "rejected"
        ) {
          void updateAssistantFromTask(event.task_id);
        }
      }
    };
    const unsubscribe = subscribe(handler);
    return () => {
      unsubscribe();
    };
  }, [subscribe, updateAssistantFromTask]);

  const sendMessage = useCallback(
    async (content: string, overrides?: SendMessageOverrides) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      const userMsg: ChatMessage = {
        id: genId(),
        role: "user",
        content: trimmed,
        timestamp: now,
      };

      // Snapshot history BEFORE adding user message for context build
      const historyForPrompt = messagesRef.current;
      const finalCwd = overrides?.projectCwd ?? projectId ?? undefined;
      const finalSessionId = overrides?.sessionId ?? sessionId ?? undefined;
      const finalAgentId = overrides?.agentId ?? agentId ?? undefined;

      const assistantMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        status: "pending",
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsSending(true);

      const fullPrompt = buildContextPrompt(historyForPrompt, trimmed);

      try {
        const task = await createTask({
          prompt: fullPrompt,
          agent_id: finalAgentId || undefined,
          cwd: finalCwd || undefined,
          session_id: finalSessionId || undefined,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, taskId: task.id, status: "running" as const }
              : m
          )
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "提交失败";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  status: "failed" as const,
                  content: `提交失败：${errMsg}`,
                }
              : m
          )
        );
      } finally {
        setIsSending(false);
      }
    },
    [projectId, sessionId, agentId]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey(projectId));
      } catch {
        // ignore
      }
    }
  }, [projectId]);

  const markRead = useCallback(() => {
    setHasUnread(false);
  }, []);

  return useMemo(
    () => ({
      messages,
      isSending,
      hasUnread,
      markRead,
      sendMessage,
      clearHistory,
    }),
    [messages, isSending, hasUnread, markRead, sendMessage, clearHistory]
  );
}
