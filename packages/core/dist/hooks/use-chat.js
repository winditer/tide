"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTask } from "../api/tasks";
import { getTask } from "../api/tasks";
import { fetchApprovals, approveApproval, rejectApproval } from "../api/approvals";
import { useWs } from "../providers/ws-provider";
const STORAGE_PREFIX = "tide.chat.history.";
const SESSION_STORAGE_PREFIX = "tide.chat.session.";
const HISTORY_LIMIT = 200;
const CONTEXT_WINDOW = 10;
const CONTEXT_PER_MESSAGE_CHARS = 200;
function storageKey(projectId) {
    return `${STORAGE_PREFIX}${projectId || "_global_"}`;
}
function sessionStorageKey(projectId, agentId) {
    const base = projectId || "_global_";
    const agent = agentId || "_auto_";
    return `${SESSION_STORAGE_PREFIX}${base}.${agent}`;
}
function loadSessionFromStorage(projectId, agentId) {
    if (typeof window === "undefined")
        return "";
    try {
        return window.localStorage.getItem(sessionStorageKey(projectId, agentId)) || "";
    }
    catch (_a) {
        return "";
    }
}
function saveSessionToStorage(projectId, agentId, sid) {
    if (typeof window === "undefined")
        return;
    try {
        if (sid) {
            window.localStorage.setItem(sessionStorageKey(projectId, agentId), sid);
        }
        else {
            window.localStorage.removeItem(sessionStorageKey(projectId, agentId));
        }
    }
    catch (_a) {
        // ignore
    }
}
function loadFromStorage(projectId) {
    if (typeof window === "undefined")
        return [];
    try {
        const raw = window.localStorage.getItem(storageKey(projectId));
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed
            .filter((m) => !!m && typeof m.id === "string")
            .map((m) => (Object.assign(Object.assign({}, m), { 
            // Status pending/running is ephemeral; treat as failed if recovered after reload
            status: m.status === "running" || m.status === "pending"
                ? "failed"
                : m.status })));
    }
    catch (_a) {
        return [];
    }
}
function saveToStorage(projectId, messages) {
    if (typeof window === "undefined")
        return;
    try {
        const slice = messages.slice(-HISTORY_LIMIT);
        window.localStorage.setItem(storageKey(projectId), JSON.stringify(slice));
    }
    catch (_a) {
        // quota exceeded — ignore
    }
}
function genId() {
    if (typeof crypto !== "undefined" &&
        typeof crypto.randomUUID ===
            "function") {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
export function buildContextPrompt(messages, newContent) {
    const recent = messages.slice(-CONTEXT_WINDOW);
    if (recent.length === 0)
        return newContent;
    const recentHistory = recent
        .map((m) => `[${m.role}]: ${(m.content || "").slice(0, CONTEXT_PER_MESSAGE_CHARS)}`)
        .join("\n");
    return `## 对话上下文\n${recentHistory}\n\n## 当前请求\n${newContent}`;
}
export function useChat(options = {}) {
    const { projectId, sessionId, agentId } = options;
    const [messages, setMessages] = useState([]);
    const [isSending, setIsSending] = useState(false);
    const [hasUnread, setHasUnread] = useState(false);
    const [chatSessionId, setChatSessionId] = useState("");
    const messagesRef = useRef([]);
    messagesRef.current = messages;
    const hydratedKeyRef = useRef(null);
    const chatSessionIdRef = useRef("");
    chatSessionIdRef.current = chatSessionId;
    // Tasks for which we've already attempted to capture session_id
    const sessionFetchedRef = useRef(new Set());
    const { subscribe } = useWs();
    // Hydrate messages from localStorage when projectId changes.
    // Note: messages are scoped per project (NOT per agent) so the UI history
    // remains stable when the user switches agent in the floating chat.
    useEffect(() => {
        const key = storageKey(projectId);
        if (hydratedKeyRef.current === key)
            return;
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
        if (hydratedKeyRef.current !== storageKey(projectId))
            return;
        saveToStorage(projectId, messages);
    }, [messages, projectId]);
    // Persist session id keyed by (projectId, agentId)
    useEffect(() => {
        if (hydratedKeyRef.current !== storageKey(projectId))
            return;
        saveSessionToStorage(projectId, agentId, chatSessionId);
    }, [chatSessionId, projectId, agentId]);
    // Lazily capture session_id from a task once available (after agent stream starts)
    const captureSessionFromTask = useCallback(async (taskId) => {
        if (chatSessionIdRef.current)
            return;
        if (sessionFetchedRef.current.has(taskId))
            return;
        sessionFetchedRef.current.add(taskId);
        try {
            const task = await getTask(taskId);
            const sid = (task && task.session_id) || "";
            if (sid && !chatSessionIdRef.current) {
                setChatSessionId(sid);
            }
            else if (!sid) {
                // Session not ready yet — allow a future retry
                sessionFetchedRef.current.delete(taskId);
            }
        }
        catch (_a) {
            sessionFetchedRef.current.delete(taskId);
        }
    }, []);
    const updateAssistantFromTask = useCallback(async (taskId) => {
        try {
            const task = await getTask(taskId);
            const status = String(task.status || "").toLowerCase();
            const finalStatus = status === "completed" || status === "approved"
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
            setMessages((prev) => prev.map((m) => {
                if (m.taskId !== taskId || m.role !== "assistant")
                    return m;
                const next = Object.assign(Object.assign({}, m), { status: finalStatus !== null && finalStatus !== void 0 ? finalStatus : m.status });
                if (finalStatus === "completed") {
                    next.content = result || "(任务已完成，无输出)";
                }
                else if (finalStatus === "failed") {
                    next.content = result || "(任务执行失败)";
                }
                return next;
            }));
            if (finalStatus === "completed" || finalStatus === "failed") {
                setHasUnread(true);
            }
        }
        catch (_a) {
            // network failure — keep message in running state
        }
    }, []);
    // Fetch pending approval for a task and attach to the streaming assistant message.
    // The interactive controls render inline within that message — we deliberately do NOT
    // append a separate notice message to avoid duplicate approval prompts (Issue #2).
    const attachApprovalToTask = useCallback(async (taskId) => {
        try {
            const resp = await fetchApprovals({ status: "pending" });
            const match = resp.items.find((a) => a.task_id === taskId);
            if (!match)
                return;
            setMessages((prev) => prev.map((m) => {
                if (m.taskId !== taskId || m.role !== "assistant")
                    return m;
                return Object.assign(Object.assign({}, m), { interactive: {
                        type: "approval",
                        approvalId: match.id,
                        taskId,
                        status: "pending",
                    } });
            }));
            setHasUnread(true);
        }
        catch (_a) {
            // ignore fetch failure
        }
    }, []);
    // Subscribe to WS events to update messages
    useEffect(() => {
        const handler = (event) => {
            var _a, _b;
            if (!event || !event.task_id)
                return;
            const trackedTaskIds = new Set(messagesRef.current
                .filter((m) => m.role === "assistant" && m.taskId)
                .map((m) => m.taskId));
            if (!trackedTaskIds.has(event.task_id))
                return;
            const type = event.type;
            // Streamed agent output — append chunks to the assistant message in real-time.
            // Backend emits `task.output` with top-level `chunk` & `output_type` fields
            // (see backend/services/event_emitter.py::emit_task_output).
            if (type === "task.output") {
                const raw = event;
                const chunk = (typeof raw.chunk === "string" ? raw.chunk : "") ||
                    (typeof ((_a = raw.payload) === null || _a === void 0 ? void 0 : _a.chunk) === "string"
                        ? raw.payload.chunk
                        : "") ||
                    "";
                if (chunk) {
                    setMessages((prev) => prev.map((m) => {
                        if (m.taskId !== event.task_id || m.role !== "assistant")
                            return m;
                        const prevContent = m.content || "";
                        const needsNewline = prevContent.length > 0 && !prevContent.endsWith("\n");
                        return Object.assign(Object.assign({}, m), { content: prevContent + (needsNewline ? "\n" : "") + chunk, status: "running" });
                    }));
                }
                // Capture session_id lazily on the first output event
                void captureSessionFromTask(event.task_id);
                return;
            }
            // Backend emits "task.status_changed" with new_status; some flows may emit
            // shorthand "task.completed" / "task.failed". Handle both.
            if (type === "task.completed" ||
                type === "task.failed" ||
                type === "task.status_changed") {
                const raw = event;
                const ns = (raw.new_status ||
                    ((_b = raw.payload) === null || _b === void 0 ? void 0 : _b.new_status) ||
                    (type === "task.completed"
                        ? "completed"
                        : type === "task.failed"
                            ? "failed"
                            : ""))
                    .toString()
                    .toLowerCase();
                // When task enters review state, fetch and attach approval info
                if (ns === "review") {
                    // Update message status to show review state
                    setMessages((prev) => prev.map((m) => {
                        if (m.taskId !== event.task_id || m.role !== "assistant")
                            return m;
                        return Object.assign(Object.assign({}, m), { content: m.content || "任务执行中，等待审批...", status: "running" });
                    }));
                    void attachApprovalToTask(event.task_id);
                }
                else if (ns === "completed" ||
                    ns === "failed" ||
                    ns === "stopped" ||
                    ns === "approved" ||
                    ns === "rejected") {
                    void updateAssistantFromTask(event.task_id);
                    // Also update any interactive messages related to this task
                    const resolvedStatus = (ns === "approved" ? "approved" : ns === "rejected" ? "rejected" : undefined);
                    if (resolvedStatus) {
                        setMessages((prev) => prev.map((m) => {
                            if (!m.interactive || m.interactive.taskId !== event.task_id)
                                return m;
                            return Object.assign(Object.assign({}, m), { interactive: Object.assign(Object.assign({}, m.interactive), { status: resolvedStatus }) });
                        }));
                    }
                }
            }
            // Handle approval-specific events
            if (type === "approval.resolved") {
                const payload = event.payload || {};
                const approvalId = payload.approval_id;
                const resolution = (payload.resolution || "").toLowerCase();
                const resolvedStatus = resolution === "approved" ? "approved" : resolution === "rejected" ? "rejected" : undefined;
                if (approvalId && resolvedStatus) {
                    setMessages((prev) => prev.map((m) => {
                        if (!m.interactive || m.interactive.approvalId !== approvalId)
                            return m;
                        return Object.assign(Object.assign({}, m), { interactive: Object.assign(Object.assign({}, m.interactive), { status: resolvedStatus }) });
                    }));
                }
            }
        };
        const unsubscribe = subscribe(handler);
        return () => {
            unsubscribe();
        };
    }, [subscribe, updateAssistantFromTask, attachApprovalToTask, captureSessionFromTask]);
    const sendMessage = useCallback(async (content, overrides) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const trimmed = content.trim();
        if (!trimmed)
            return;
        const now = new Date().toISOString();
        const userMsg = {
            id: genId(),
            role: "user",
            content: trimmed,
            timestamp: now,
        };
        // Snapshot history BEFORE adding user message for context build
        const historyForPrompt = messagesRef.current;
        const finalCwd = (_b = (_a = overrides === null || overrides === void 0 ? void 0 : overrides.projectCwd) !== null && _a !== void 0 ? _a : projectId) !== null && _b !== void 0 ? _b : undefined;
        const finalSessionId = (_e = (_d = (_c = overrides === null || overrides === void 0 ? void 0 : overrides.sessionId) !== null && _c !== void 0 ? _c : sessionId) !== null && _d !== void 0 ? _d : chatSessionIdRef.current) !== null && _e !== void 0 ? _e : undefined;
        const finalAgentId = (_g = (_f = overrides === null || overrides === void 0 ? void 0 : overrides.agentId) !== null && _f !== void 0 ? _f : agentId) !== null && _g !== void 0 ? _g : undefined;
        const finalGroupId = (_h = overrides === null || overrides === void 0 ? void 0 : overrides.groupId) !== null && _h !== void 0 ? _h : undefined;
        const assistantMsg = {
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
            setMessages((prev) => prev.map((m) => m.id === assistantMsg.id
                ? Object.assign(Object.assign({}, m), { taskId: task.id, status: "running" }) : m));
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : "提交失败";
            // Session fallback: if createTask failed while using a session_id,
            // check whether the error indicates a stale/invalid session and retry
            // without session_id (similar to backend executor.py L189-222).
            const sessionKeywords = ["session", "404", "not found", "not_found", "logged", "login"];
            const isSessionError = !!finalSessionId &&
                sessionKeywords.some((kw) => errMsg.toLowerCase().includes(kw));
            if (isSessionError) {
                console.warn("[useChat] Session invalid, clearing session and retrying:", errMsg);
                // Clear stale session
                setChatSessionId("");
                try {
                    window.localStorage.removeItem(sessionStorageKey(projectId, agentId));
                }
                catch (_j) {
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
                    setMessages((prev) => prev.map((m) => m.id === assistantMsg.id
                        ? Object.assign(Object.assign({}, m), { taskId: task.id, status: "running" }) : m));
                }
                catch (retryErr) {
                    const retryMsg = retryErr instanceof Error ? retryErr.message : "提交失败";
                    setMessages((prev) => prev.map((m) => m.id === assistantMsg.id
                        ? Object.assign(Object.assign({}, m), { status: "failed", content: `提交失败：${retryMsg}` }) : m));
                }
            }
            else {
                setMessages((prev) => prev.map((m) => m.id === assistantMsg.id
                    ? Object.assign(Object.assign({}, m), { status: "failed", content: `提交失败：${errMsg}` }) : m));
            }
        }
        finally {
            setIsSending(false);
        }
    }, [projectId, sessionId, agentId]);
    const clearHistory = useCallback(() => {
        setMessages([]);
        setChatSessionId("");
        sessionFetchedRef.current = new Set();
        if (typeof window !== "undefined") {
            try {
                window.localStorage.removeItem(storageKey(projectId));
                window.localStorage.removeItem(sessionStorageKey(projectId, agentId));
            }
            catch (_a) {
                // ignore
            }
        }
    }, [projectId, agentId]);
    const markRead = useCallback(() => {
        setHasUnread(false);
    }, []);
    const approveTask = useCallback(async (approvalId, comment) => {
        try {
            await approveApproval(approvalId, undefined, comment);
            setMessages((prev) => prev.map((m) => {
                if (!m.interactive || m.interactive.approvalId !== approvalId)
                    return m;
                return Object.assign(Object.assign({}, m), { interactive: Object.assign(Object.assign({}, m.interactive), { status: "approved" }) });
            }));
            // Append confirmation message
            const confirmMsg = {
                id: genId(),
                role: "assistant",
                content: "\u2705 审批已通过",
                timestamp: new Date().toISOString(),
                status: "completed",
                interactive: { type: "info", status: "approved" },
            };
            setMessages((prev) => [...prev, confirmMsg]);
            setHasUnread(true);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : "操作失败";
            const failMsg = {
                id: genId(),
                role: "assistant",
                content: `\u274C 审批操作失败：${errMsg}`,
                timestamp: new Date().toISOString(),
                status: "failed",
            };
            setMessages((prev) => [...prev, failMsg]);
        }
    }, []);
    const rejectTask = useCallback(async (approvalId, comment) => {
        try {
            await rejectApproval(approvalId, undefined, comment);
            setMessages((prev) => prev.map((m) => {
                if (!m.interactive || m.interactive.approvalId !== approvalId)
                    return m;
                return Object.assign(Object.assign({}, m), { interactive: Object.assign(Object.assign({}, m.interactive), { status: "rejected" }) });
            }));
            // Append confirmation message
            const confirmMsg = {
                id: genId(),
                role: "assistant",
                content: "\u274C 审批已拒绝",
                timestamp: new Date().toISOString(),
                status: "completed",
                interactive: { type: "info", status: "rejected" },
            };
            setMessages((prev) => [...prev, confirmMsg]);
            setHasUnread(true);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : "操作失败";
            const failMsg = {
                id: genId(),
                role: "assistant",
                content: `\u274C 拒绝操作失败：${errMsg}`,
                timestamp: new Date().toISOString(),
                status: "failed",
            };
            setMessages((prev) => [...prev, failMsg]);
        }
    }, []);
    return useMemo(() => ({
        messages,
        isSending,
        hasUnread,
        markRead,
        sendMessage,
        clearHistory,
        approveTask,
        rejectTask,
    }), [messages, isSending, hasUnread, markRead, sendMessage, clearHistory, approveTask, rejectTask]);
}
//# sourceMappingURL=use-chat.js.map