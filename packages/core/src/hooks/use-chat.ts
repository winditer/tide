"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTask } from "../api/tasks";
import { getTask } from "../api/tasks";
import { fetchApprovals, approveApproval, rejectApproval } from "../api/approvals";
import { useWs } from "../providers/ws-provider";
import type { TaskEvent } from "../types/task";

export type ChatMessageStatus = "pending" | "running" | "completed" | "failed";
export type ChatMessageRole = "user" | "assistant";

export type ChatInteractiveType = "approval" | "info" | "action";
export type ChatInteractiveStatus = "pending" | "approved" | "rejected";

export interface ChatInteractive {
  type: ChatInteractiveType;
  approvalId?: string;
  taskId?: string;
  status?: ChatInteractiveStatus;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  /** ISO string for serialization safety; rendered components should parse */
  timestamp: string;
  taskId?: string;
  status?: ChatMessageStatus;
  interactive?: ChatInteractive;
}

export type ChatArtifactType = "file" | "link" | "markdown";

export interface ChatArtifact {
  id: string;
  label: string;
  url: string;
  type: ChatArtifactType;
  created_at?: string;
  task_id?: string;
}

/**
 * Extract artifact-like links from a message content.
 * Matches:
 *  1. `[label](url)` where url is `/api/...`, `http(s)://...`, or an absolute
 *     file path like `/Users/.../file.md`.
 *  2. Common file-creation patterns: "File created successfully at: <path>",
 *     "Created file: <path>", "写入文件: <path>".
 * Used as a supplementary source alongside backend `task.artifact` events.
 */
export function extractArtifactsFromContent(
  content: string,
  taskId?: string
): ChatArtifact[] {
  if (!content) return [];
  const seen = new Set<string>();
  const result: ChatArtifact[] = [];

  const addArtifact = (label: string, url: string) => {
    if (!label || !url || seen.has(url)) return;
    seen.add(url);
    const isExternal = /^https?:/i.test(url);
    const lower = url.toLowerCase().split(/[?#]/)[0];
    const isMarkdown = lower.endsWith(".md") || lower.endsWith(".markdown");
    const type: ChatArtifactType = isExternal
      ? "link"
      : isMarkdown
        ? "markdown"
        : "file";
    result.push({
      id: `${taskId || "inline"}::${url}`,
      label,
      url,
      type,
      task_id: taskId,
    });
  };

  // 1. Markdown links: /api/..., http(s)://..., or absolute file paths (containing / and a file extension)
  const linkRegex = /\[([^\]]+)\]\((\/api\/[^)\s]+|https?:\/\/[^)\s]+|\/[^)\s]*\/[^)\s]+\.[a-zA-Z0-9]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(content)) !== null) {
    addArtifact((match[1] || "").trim(), (match[2] || "").trim().replace(/^[`'"\s]+|[`'"\s]+$/g, ""));
  }

  // 2. File creation patterns (English + Chinese)
  const pathPatterns = [
    /File created successfully at:\s*(.+?)(?:\n|$)/gi,
    /Created file:\s*(.+?)(?:\n|$)/gi,
    /写入文件[:：]\s*(.+?)(?:\n|$)/g,
  ];
  // Strip code blocks to avoid false positives
  const stripped = content.replace(/```[\s\S]*?```/g, "");
  for (const pattern of pathPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(stripped)) !== null) {
      const path = (m[1] || "").trim().replace(/^[`'"\s]+|[`'"\s]+$/g, "");
      if (!path || !path.startsWith("/")) continue;
      const label = path.split("/").pop() || path;
      addArtifact(label, path);
    }
  }

  return result;
}

function mergeArtifactsByUrl(
  prev: ChatArtifact[],
  next: ChatArtifact[]
): ChatArtifact[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((a) => a.url));
  const additions: ChatArtifact[] = [];
  for (const a of next) {
    if (!a || !a.url || seen.has(a.url)) continue;
    seen.add(a.url);
    additions.push(a);
  }
  return additions.length === 0 ? prev : [...prev, ...additions];
}

export interface UseChatOptions {
  projectId?: string;
  sessionId?: string;
  agentId?: string;
}

const STORAGE_PREFIX = "tide.chat.history.";
const SESSION_STORAGE_PREFIX = "tide.chat.session.";
const HISTORY_LIMIT = 200;
const CONTEXT_WINDOW = 10;
const CONTEXT_PER_MESSAGE_CHARS = 200;

function storageKey(projectId?: string): string {
  return `${STORAGE_PREFIX}${projectId || "_global_"}`;
}

function sessionStorageKey(projectId?: string, agentId?: string): string {
  const base = projectId || "_global_";
  const agent = agentId || "_auto_";
  return `${SESSION_STORAGE_PREFIX}${base}.${agent}`;
}

function loadSessionFromStorage(projectId?: string, agentId?: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(sessionStorageKey(projectId, agentId)) || "";
  } catch {
    return "";
  }
}

function saveSessionToStorage(
  projectId: string | undefined,
  agentId: string | undefined,
  sid: string
) {
  if (typeof window === "undefined") return;
  try {
    if (sid) {
      window.localStorage.setItem(sessionStorageKey(projectId, agentId), sid);
    } else {
      window.localStorage.removeItem(sessionStorageKey(projectId, agentId));
    }
  } catch {
    // ignore
  }
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
  groupId?: string;
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
  approveTask: (approvalId: string, comment?: string) => Promise<void>;
  rejectTask: (approvalId: string, comment?: string) => Promise<void>;
  artifacts: ChatArtifact[];
  clearArtifacts: () => void;
}

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { projectId, sessionId, agentId } = options;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string>("");
  const [artifacts, setArtifacts] = useState<ChatArtifact[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const hydratedKeyRef = useRef<string | null>(null);
  const chatSessionIdRef = useRef<string>("");
  chatSessionIdRef.current = chatSessionId;
  // Tasks for which we've already attempted to capture session_id
  const sessionFetchedRef = useRef<Set<string>>(new Set());

  const { subscribe } = useWs();

  // Hydrate messages from localStorage when projectId changes.
  // Note: messages are scoped per project (NOT per agent) so the UI history
  // remains stable when the user switches agent in the floating chat.
  useEffect(() => {
    const key = storageKey(projectId);
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    const stored = loadFromStorage(projectId);
    setMessages(stored);
    sessionFetchedRef.current = new Set();
  }, [projectId]);

  // Reload the session_id whenever the (projectId, agentId) pair changes.
  // Each agent has its own session_id so resuming after switching back works.
  useEffect(() => {
    const sid = loadSessionFromStorage(projectId, agentId);
    setChatSessionId(sid);
    sessionFetchedRef.current = new Set();
  }, [projectId, agentId]);

  // Persist on every change
  useEffect(() => {
    if (hydratedKeyRef.current !== storageKey(projectId)) return;
    saveToStorage(projectId, messages);
  }, [messages, projectId]);

  // Persist session id keyed by (projectId, agentId)
  useEffect(() => {
    if (hydratedKeyRef.current !== storageKey(projectId)) return;
    saveSessionToStorage(projectId, agentId, chatSessionId);
  }, [chatSessionId, projectId, agentId]);

  // Lazily capture session_id from a task once available (after agent stream starts)
  const captureSessionFromTask = useCallback(async (taskId: string) => {
    if (chatSessionIdRef.current) return;
    if (sessionFetchedRef.current.has(taskId)) return;
    sessionFetchedRef.current.add(taskId);
    try {
      const task = await getTask(taskId);
      const sid = (task && task.session_id) || "";
      if (sid && !chatSessionIdRef.current) {
        setChatSessionId(sid);
      } else if (!sid) {
        // Session not ready yet — allow a future retry
        sessionFetchedRef.current.delete(taskId);
      }
    } catch {
      sessionFetchedRef.current.delete(taskId);
    }
  }, []);

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
      // Capture session_id once available so subsequent messages reuse the session
      const taskSid = (task.session_id || "").toString();
      if (taskSid && !chatSessionIdRef.current) {
        setChatSessionId(taskSid);
      }
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
      // Extract artifact-style links from the final assistant content
      // as a supplementary source to the structured task.artifact events.
      if (finalStatus === "completed" && result) {
        const finalArts = extractArtifactsFromContent(result, taskId);
        if (finalArts.length > 0) {
          setArtifacts((prev) => mergeArtifactsByUrl(prev, finalArts));
        }
      }
    } catch {
      // network failure — keep message in running state
    }
  }, []);

  // Fetch pending approval for a task and attach to the streaming assistant message.
  // The interactive controls render inline within that message — we deliberately do NOT
  // append a separate notice message to avoid duplicate approval prompts (Issue #2).
  const attachApprovalToTask = useCallback(async (taskId: string) => {
    try {
      const resp = await fetchApprovals({ status: "pending" });
      const match = resp.items.find((a) => a.task_id === taskId);
      if (!match) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.taskId !== taskId || m.role !== "assistant") return m;
          return {
            ...m,
            interactive: {
              type: "approval" as const,
              approvalId: match.id,
              taskId,
              status: "pending" as const,
            },
          };
        })
      );
      setHasUnread(true);
    } catch {
      // ignore fetch failure
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

      // Streamed agent output — append chunks to the assistant message in real-time.
      // Backend emits `task.output` with top-level `chunk` & `output_type` fields
      // (see backend/services/event_emitter.py::emit_task_output).
      if (type === "task.output") {
        const raw = event as TaskEvent & {
          chunk?: string;
          output_type?: string;
          payload?: Record<string, unknown>;
        };
        const rawChunk =
          (typeof raw.chunk === "string" ? raw.chunk : "") ||
          (typeof raw.payload?.chunk === "string"
            ? (raw.payload!.chunk as string)
            : "") ||
          "";
        // Filter CLI stdin noise before appending to message
        const chunk = rawChunk
          .replace(/^Reading additional input from stdin\.{0,3}\n?/gm, "")
          .replace(/^Reading from stdin\.{0,3}\n?/gm, "")
          .trim();
        if (chunk) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.taskId !== event.task_id || m.role !== "assistant") return m;
              const prevContent = m.content || "";
              const needsNewline =
                prevContent.length > 0 && !prevContent.endsWith("\n");
              return {
                ...m,
                content: prevContent + (needsNewline ? "\n" : "") + chunk,
                status: "running" as ChatMessageStatus,
              };
            })
          );
          // Opportunistically extract artifact-style links from the chunk;
          // backend `task.artifact` event remains the authoritative source.
          const inlineArts = extractArtifactsFromContent(chunk, event.task_id);
          if (inlineArts.length > 0) {
            setArtifacts((prev) => mergeArtifactsByUrl(prev, inlineArts));
          }
        }
        // Capture session_id lazily on the first output event
        void captureSessionFromTask(event.task_id);
        return;
      }

      // Backend pushes structured artifacts when a task produces files/links.
      // See backend/services/event_emitter.py + WS hub for the payload shape.
      if (type === "task.artifact") {
        const raw = event as TaskEvent & {
          artifacts?: Array<{
            id?: string;
            label?: string;
            url?: string;
            type?: string;
            task_id?: string;
            created_at?: string;
          }>;
          payload?: Record<string, unknown>;
        };
        const list =
          (Array.isArray(raw.artifacts) ? raw.artifacts : null) ||
          (Array.isArray(raw.payload?.artifacts)
            ? (raw.payload!.artifacts as Array<Record<string, unknown>>)
            : null) ||
          [];
        if (list.length > 0) {
          const allowed: ChatArtifactType[] = ["file", "link", "markdown"];
          const incoming: ChatArtifact[] = [];
          for (const a of list as Array<Record<string, unknown>>) {
            if (!a) continue;
            const url = typeof a.url === "string" ? a.url : "";
            if (!url) continue;
            const rawType = typeof a.type === "string" ? a.type : "";
            const type = (allowed.includes(rawType as ChatArtifactType)
              ? rawType
              : "file") as ChatArtifactType;
            incoming.push({
              id:
                (typeof a.id === "string" && a.id) ||
                `${event.task_id}::${url}`,
              label: (typeof a.label === "string" && a.label) || "附件",
              url,
              type,
              task_id:
                (typeof a.task_id === "string" && a.task_id) ||
                event.task_id,
              created_at:
                (typeof a.created_at === "string" && a.created_at) ||
                event.timestamp ||
                new Date().toISOString(),
            });
          }
          if (incoming.length > 0) {
            setArtifacts((prev) => mergeArtifactsByUrl(prev, incoming));
            setHasUnread(true);
          }
        }
        return;
      }
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

        // When task enters review state, fetch and attach approval info
        if (ns === "review") {
          // Update message status to show review state
          setMessages((prev) =>
            prev.map((m) => {
              if (m.taskId !== event.task_id || m.role !== "assistant") return m;
              return { ...m, content: m.content || "任务执行中，等待审批...", status: "running" };
            })
          );
          void attachApprovalToTask(event.task_id);
        } else if (
          ns === "completed" ||
          ns === "failed" ||
          ns === "stopped" ||
          ns === "approved" ||
          ns === "rejected"
        ) {
          void updateAssistantFromTask(event.task_id);
          // Also update any interactive messages related to this task
          const resolvedStatus = (ns === "approved" ? "approved" : ns === "rejected" ? "rejected" : undefined) as
            | "approved"
            | "rejected"
            | undefined;
          if (resolvedStatus) {
            setMessages((prev) =>
              prev.map((m) => {
                if (!m.interactive || m.interactive.taskId !== event.task_id) return m;
                return {
                  ...m,
                  interactive: { ...m.interactive, status: resolvedStatus },
                };
              })
            );
          }
        }
      }

      // Handle approval-specific events
      if (type === "approval.resolved") {
        const payload = event.payload || {};
        const approvalId = payload.approval_id as string | undefined;
        const resolution = (payload.resolution as string || "").toLowerCase();
        const resolvedStatus = resolution === "approved" ? "approved" : resolution === "rejected" ? "rejected" : undefined;
        if (approvalId && resolvedStatus) {
          setMessages((prev) =>
            prev.map((m) => {
              if (!m.interactive || m.interactive.approvalId !== approvalId) return m;
              return {
                ...m,
                interactive: { ...m.interactive, status: resolvedStatus as ChatInteractiveStatus },
              };
            })
          );
        }
      }
    };
    const unsubscribe = subscribe(handler);
    return () => {
      unsubscribe();
    };
  }, [subscribe, updateAssistantFromTask, attachApprovalToTask, captureSessionFromTask]);

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
      const finalSessionId =
        overrides?.sessionId ??
        sessionId ??
        chatSessionIdRef.current ??
        undefined;
      const finalAgentId = overrides?.agentId ?? agentId ?? undefined;
      const finalGroupId = overrides?.groupId ?? undefined;

      const assistantMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        status: "pending",
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsSending(true);

      // When resuming an existing agent session, the agent already retains the
      // full conversation history server-side — re-prepending it would cause the
      // agent to "reference the previous conversation" as a fresh context block
      // (Issue #6). Only build the context prompt for the very first message.
      const fullPrompt = finalSessionId
        ? trimmed
        : buildContextPrompt(historyForPrompt, trimmed);

      try {
        const task = await createTask({
          prompt: fullPrompt,
          agent_id: finalAgentId || undefined,
          cwd: finalCwd || undefined,
          session_id: finalSessionId || undefined,
          group_id: finalGroupId || undefined,
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

        // Session fallback: if createTask failed while using a session_id,
        // check whether the error indicates a stale/invalid session and retry
        // without session_id (similar to backend executor.py L189-222).
        const sessionKeywords = ["session", "404", "not found", "not_found", "logged", "login"];
        const isSessionError =
          !!finalSessionId &&
          sessionKeywords.some((kw) => errMsg.toLowerCase().includes(kw));

        if (isSessionError) {
          console.warn(
            "[useChat] Session invalid, clearing session and retrying:",
            errMsg
          );
          // Clear stale session
          setChatSessionId("");
          try {
            window.localStorage.removeItem(
              sessionStorageKey(projectId, agentId)
            );
          } catch {
            // ignore storage errors
          }

          // Rebuild prompt with full context since we lost the session
          const fallbackPrompt = buildContextPrompt(historyForPrompt, trimmed);

          try {
            const task = await createTask({
              prompt: fallbackPrompt,
              agent_id: finalAgentId || undefined,
              cwd: finalCwd || undefined,
              session_id: undefined,
              group_id: finalGroupId || undefined,
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, taskId: task.id, status: "running" as const }
                  : m
              )
            );
          } catch (retryErr) {
            const retryMsg =
              retryErr instanceof Error ? retryErr.message : "提交失败";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      status: "failed" as const,
                      content: `提交失败：${retryMsg}`,
                    }
                  : m
              )
            );
          }
        } else {
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
        }
      } finally {
        setIsSending(false);
      }
    },
    [projectId, sessionId, agentId]
  );

  const clearArtifacts = useCallback(() => setArtifacts([]), []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setChatSessionId("");
    sessionFetchedRef.current = new Set();
    setArtifacts([]);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey(projectId));
        window.localStorage.removeItem(sessionStorageKey(projectId, agentId));
      } catch {
        // ignore
      }
    }
  }, [projectId, agentId]);

  const markRead = useCallback(() => {
    setHasUnread(false);
  }, []);

  const approveTask = useCallback(async (approvalId: string, comment?: string) => {
    try {
      await approveApproval(approvalId, undefined, comment);
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.interactive || m.interactive.approvalId !== approvalId) return m;
          return {
            ...m,
            interactive: { ...m.interactive, status: "approved" as const },
          };
        })
      );
      // Append confirmation message
      const confirmMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: "\u2705 审批已通过",
        timestamp: new Date().toISOString(),
        status: "completed",
        interactive: { type: "info", status: "approved" },
      };
      setMessages((prev) => [...prev, confirmMsg]);
      setHasUnread(true);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "操作失败";
      const failMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: `\u274C 审批操作失败：${errMsg}`,
        timestamp: new Date().toISOString(),
        status: "failed",
      };
      setMessages((prev) => [...prev, failMsg]);
    }
  }, []);

  const rejectTask = useCallback(async (approvalId: string, comment?: string) => {
    try {
      await rejectApproval(approvalId, undefined, comment);
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.interactive || m.interactive.approvalId !== approvalId) return m;
          return {
            ...m,
            interactive: { ...m.interactive, status: "rejected" as const },
          };
        })
      );
      // Append confirmation message
      const confirmMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: "\u274C 审批已拒绝",
        timestamp: new Date().toISOString(),
        status: "completed",
        interactive: { type: "info", status: "rejected" },
      };
      setMessages((prev) => [...prev, confirmMsg]);
      setHasUnread(true);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "操作失败";
      const failMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: `\u274C 拒绝操作失败：${errMsg}`,
        timestamp: new Date().toISOString(),
        status: "failed",
      };
      setMessages((prev) => [...prev, failMsg]);
    }
  }, []);

  return useMemo(
    () => ({
      messages,
      isSending,
      hasUnread,
      markRead,
      sendMessage,
      clearHistory,
      approveTask,
      rejectTask,
      artifacts,
      clearArtifacts,
    }),
    [
      messages,
      isSending,
      hasUnread,
      markRead,
      sendMessage,
      clearHistory,
      approveTask,
      rejectTask,
      artifacts,
      clearArtifacts,
    ]
  );
}
