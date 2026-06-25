"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState, } from "react";
import { useAgents, useChat, useProjects, useProjectGroups } from "@tide/core";
import { ChatMessageList } from "./ChatMessageList";
const DEFAULT_POSITION = { bottom: 24, right: 24 };
const POSITION_STORAGE_KEY = "tide.floating-chat.position";
const PROJECT_STORAGE_KEY = "tide.floating-chat.project";
const SCOPE_STORAGE_KEY = "tide.floating-chat.scope";
const AGENT_STORAGE_KEY = "tide.floating-chat.agent";
const BUTTON_SIZE = 48;
const DRAG_THRESHOLD = 4;
const WINDOW_W = 380;
const WINDOW_H = 520;
const MIN_W = 320;
const MIN_H = 400;
const MAX_W_VW = 0.9;
const MAX_H_VH = 0.85;
function loadPosition() {
    if (typeof window === "undefined")
        return DEFAULT_POSITION;
    try {
        const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
        if (!raw)
            return DEFAULT_POSITION;
        const parsed = JSON.parse(raw);
        return {
            bottom: typeof parsed.bottom === "number" ? parsed.bottom : DEFAULT_POSITION.bottom,
            right: typeof parsed.right === "number" ? parsed.right : DEFAULT_POSITION.right,
        };
    }
    catch (_a) {
        return DEFAULT_POSITION;
    }
}
function savePosition(pos) {
    if (typeof window === "undefined")
        return;
    try {
        window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
    }
    catch (_a) {
        // ignore
    }
}
function readLocal(key) {
    if (typeof window === "undefined")
        return "";
    try {
        return window.localStorage.getItem(key) || "";
    }
    catch (_a) {
        return "";
    }
}
function writeLocal(key, value) {
    if (typeof window === "undefined")
        return;
    try {
        if (value)
            window.localStorage.setItem(key, value);
        else
            window.localStorage.removeItem(key);
    }
    catch (_a) {
        // ignore
    }
}
export function FloatingChat() {
    var _a, _b, _c, _d, _e;
    const [mounted, setMounted] = useState(false);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(DEFAULT_POSITION);
    /** 统一作用域选择。编码："project:<cwd>" / "group:<id>" / ""。 */
    const [scopeValue, setScopeValue] = useState("");
    const [agentId, setAgentId] = useState("");
    const [draftInput, setDraftInput] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const [windowSize, setWindowSize] = useState({ width: WINDOW_W, height: WINDOW_H });
    // hydrate
    useEffect(() => {
        setMounted(true);
        setPosition(loadPosition());
        // 优先读新 key；以前只保存 cwd 的旧 key 按 project: 前缀迁移
        const newScope = readLocal(SCOPE_STORAGE_KEY);
        if (newScope) {
            setScopeValue(newScope);
        }
        else {
            const legacyCwd = readLocal(PROJECT_STORAGE_KEY);
            setScopeValue(legacyCwd ? `project:${legacyCwd}` : "");
        }
        setAgentId(readLocal(AGENT_STORAGE_KEY));
    }, []);
    useEffect(() => {
        if (mounted)
            writeLocal(SCOPE_STORAGE_KEY, scopeValue);
    }, [scopeValue, mounted]);
    useEffect(() => {
        if (mounted)
            writeLocal(AGENT_STORAGE_KEY, agentId);
    }, [agentId, mounted]);
    const projectsQuery = useProjects();
    const projects = (_b = (_a = projectsQuery.data) === null || _a === void 0 ? void 0 : _a.projects) !== null && _b !== void 0 ? _b : [];
    const groupsQuery = useProjectGroups();
    const groups = (_d = (_c = groupsQuery.data) === null || _c === void 0 ? void 0 : _c.groups) !== null && _d !== void 0 ? _d : [];
    const { data: agentsData } = useAgents();
    const agents = (_e = agentsData === null || agentsData === void 0 ? void 0 : agentsData.agents) !== null && _e !== void 0 ? _e : [];
    // 从统一 scope 解码出当前选择的项目 cwd 与项目组 id
    const projectCwd = scopeValue.startsWith("project:") ? scopeValue.slice(8) : "";
    const groupId = scopeValue.startsWith("group:") ? scopeValue.slice(6) : "";
    const selectedProject = useMemo(() => { var _a; return (_a = projects.find((p) => p.cwd === projectCwd)) !== null && _a !== void 0 ? _a : null; }, [projects, projectCwd]);
    const selectedGroup = useMemo(() => { var _a; return (_a = groups.find((g) => g.id === groupId)) !== null && _a !== void 0 ? _a : null; }, [groups, groupId]);
    const chat = useChat({
        projectId: projectCwd || undefined,
        agentId: agentId || undefined,
    });
    // Keep a stable ref to chat to avoid stale closures & dependency instability
    const chatRef = useRef(chat);
    chatRef.current = chat;
    const sendingRef = useRef(false);
    const handleSend = useCallback(async () => {
        const trimmed = draftInput.trim();
        if (!trimmed)
            return;
        if (chatRef.current.isSending) {
            console.warn("[FloatingChat] Blocked: chat.isSending");
            return;
        }
        if (sendingRef.current) {
            console.warn("[FloatingChat] Blocked: sendingRef active");
            return;
        }
        sendingRef.current = true;
        setDraftInput("");
        try {
            await chatRef.current.sendMessage(trimmed, {
                projectCwd: projectCwd || undefined,
                groupId: groupId || undefined,
                agentId: agentId || undefined,
            });
        }
        finally {
            sendingRef.current = false;
        }
    }, [draftInput, projectCwd, groupId, agentId]);
    const handleKeyDown = useCallback((e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void handleSend();
        }
    }, [handleSend]);
    // Drag handling
    const dragStateRef = useRef(null);
    const handleMouseDown = useCallback((e) => {
        if (e.button !== 0)
            return;
        dragStateRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startBottom: position.bottom,
            startRight: position.right,
            moved: false,
        };
    }, [position]);
    useEffect(() => {
        function handleMove(e) {
            const state = dragStateRef.current;
            if (!state)
                return;
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            if (!state.moved &&
                Math.abs(dx) < DRAG_THRESHOLD &&
                Math.abs(dy) < DRAG_THRESHOLD) {
                return;
            }
            state.moved = true;
            setIsDragging(true);
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const nextRight = Math.min(Math.max(state.startRight - dx, 8), vw - BUTTON_SIZE - 8);
            const nextBottom = Math.min(Math.max(state.startBottom - dy, 8), vh - BUTTON_SIZE - 8);
            setPosition({ bottom: nextBottom, right: nextRight });
        }
        function handleUp() {
            const state = dragStateRef.current;
            if (!state)
                return;
            dragStateRef.current = null;
            if (state.moved) {
                // commit position; click suppressed via isDragging guard
                setIsDragging(false);
                setPosition((cur) => {
                    savePosition(cur);
                    return cur;
                });
            }
            else {
                setIsDragging(false);
            }
        }
        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleUp);
        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
        };
    }, []);
    const handleButtonClick = useCallback(() => {
        if (isDragging)
            return;
        const next = !open;
        setOpen(next);
        if (next)
            chatRef.current.markRead();
    }, [open, isDragging]);
    // --- Resize drag logic ---
    const resizeRef = useRef(null);
    useEffect(() => {
        function onResizeMove(e) {
            const s = resizeRef.current;
            if (!s)
                return;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const maxW = vw * MAX_W_VW;
            const maxH = vh * MAX_H_VH;
            // dragging from left-top: moving left increases width, moving up increases height
            const newW = Math.min(Math.max(s.startW - (e.clientX - s.startX), MIN_W), maxW);
            const newH = Math.min(Math.max(s.startH - (e.clientY - s.startY), MIN_H), maxH);
            setWindowSize({ width: newW, height: newH });
        }
        function onResizeUp() {
            resizeRef.current = null;
        }
        window.addEventListener("mousemove", onResizeMove);
        window.addEventListener("mouseup", onResizeUp);
        return () => {
            window.removeEventListener("mousemove", onResizeMove);
            window.removeEventListener("mouseup", onResizeUp);
        };
    }, []);
    const handleResizeMouseDown = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startW: windowSize.width,
            startH: windowSize.height,
        };
    }, [windowSize]);
    // Compute window position so it stays anchored above the button and on screen
    const windowStyle = useMemo(() => {
        if (isMaximized) {
            return {
                inset: 16,
                bottom: 16,
                right: 16,
                width: "calc(100vw - 32px)",
                height: "calc(100vh - 32px)",
            };
        }
        if (typeof window === "undefined") {
            return { bottom: position.bottom + BUTTON_SIZE + 14, right: position.right };
        }
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const curW = windowSize.width;
        const curH = windowSize.height;
        let bottom = position.bottom + BUTTON_SIZE + 14;
        if (bottom + curH > vh - 8) {
            bottom = Math.max(vh - curH - 8, 8);
        }
        let right = position.right;
        if (right + curW > vw - 8) {
            right = Math.max(vw - curW - 8, 8);
        }
        return { bottom, right };
    }, [position, isMaximized, windowSize]);
    if (!mounted)
        return null;
    const unread = chat.hasUnread && !open;
    return (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", "aria-label": open ? "关闭对话" : "打开对话", onMouseDown: handleMouseDown, onClick: handleButtonClick, style: { bottom: position.bottom, right: position.right }, className: "fixed z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-smooth hover:scale-105 hover:shadow-xl " +
                    (isDragging ? "cursor-grabbing" : "cursor-grab"), children: [_jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }) }), unread && (_jsx("span", { className: "absolute -right-0.5 -top-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border-2 border-background bg-destructive" }))] }), open && (_jsxs("div", { style: windowStyle, className: "fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl", children: [!isMaximized && (_jsx("div", { onMouseDown: handleResizeMouseDown, className: "absolute left-1 top-1 z-10 flex h-4 w-4 cursor-nw-resize items-end justify-end opacity-40 transition-opacity hover:opacity-90", title: "\u62D6\u52A8\u8C03\u6574\u5927\u5C0F", children: _jsxs("svg", { width: "10", height: "10", viewBox: "0 0 10 10", className: "text-zinc-50", children: [_jsx("path", { d: "M0 10 L10 0", stroke: "currentColor", strokeWidth: "1.5" }), _jsx("path", { d: "M0 6 L6 0", stroke: "currentColor", strokeWidth: "1.5" })] }) })), _jsxs("div", { style: isMaximized
                            ? { width: "100%", height: "100%" }
                            : { width: windowSize.width, height: windowSize.height }, className: "flex flex-col overflow-hidden", children: [_jsxs("div", { className: "flex h-12 shrink-0 items-center gap-2 border-b border-border/50 bg-[hsl(224_71%_4%)] px-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" }), _jsx("span", { className: "text-[13px] font-medium tracking-wide text-white", children: "Chat" })] }), _jsxs("div", { className: "ml-auto flex items-center gap-1", children: [_jsx("button", { type: "button", onClick: chat.clearHistory, title: "\u6E05\u7A7A\u5386\u53F2", className: "flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white", children: _jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "M3 6h18" }), _jsx("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }), _jsx("path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" })] }) }), _jsx("button", { type: "button", onClick: () => setIsMaximized((v) => !v), title: isMaximized ? "还原" : "最大化", className: "flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white", children: isMaximized ? (_jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("rect", { x: "5", y: "5", width: "14", height: "14", rx: "1" }), _jsx("path", { d: "M9 3v2" }), _jsx("path", { d: "M15 3v2" }), _jsx("path", { d: "M9 19v2" }), _jsx("path", { d: "M15 19v2" })] })) : (_jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }) })) }), _jsx("button", { type: "button", onClick: () => setOpen(false), title: "\u5173\u95ED", className: "flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white", children: _jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "M18 6 6 18" }), _jsx("path", { d: "m6 6 12 12" })] }) })] })] }), _jsxs("div", { className: "flex shrink-0 items-center gap-2 border-b border-border/50 bg-card px-3 py-2", children: [_jsxs("select", { value: scopeValue, onChange: (e) => setScopeValue(e.target.value), className: "h-7 max-w-[170px] flex-1 truncate rounded-md border border-border/50 bg-muted/50 px-2 text-xs text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30", children: [_jsx("option", { value: "", children: "\u65E0\u9879\u76EE \u00B7 \u7EAF\u5BF9\u8BDD" }), projects.length > 0 && (_jsx("optgroup", { label: "\u9879\u76EE", children: projects.map((p) => (_jsx("option", { value: `project:${p.cwd}`, children: p.name }, p.id))) })), groups.length > 0 && (_jsx("optgroup", { label: "\u9879\u76EE\u7EC4", children: groups.map((g) => (_jsx("option", { value: `group:${g.id}`, children: g.name }, g.id))) }))] }), _jsxs("select", { value: agentId, onChange: (e) => setAgentId(e.target.value), className: "h-7 w-[110px] rounded-md border border-border/50 bg-muted/50 px-2 text-xs text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30", children: [_jsx("option", { value: "", children: "\u81EA\u52A8" }), agents.map((a) => (_jsx("option", { value: a.id, children: a.name }, a.id)))] })] }), _jsx("div", { className: "flex-1 overflow-hidden bg-background", children: _jsx(ChatMessageList, { messages: chat.messages, emptyHint: selectedGroup
                                        ? `在项目组「${selectedGroup.name}」中执行任务`
                                        : selectedProject
                                            ? `在「${selectedProject.name}」中执行任务`
                                            : "纯对话模式 · 不绑定项目", onApprove: (approvalId, comment) => void chat.approveTask(approvalId, comment), onReject: (approvalId, comment) => void chat.rejectTask(approvalId, comment) }) }), _jsxs("div", { className: "shrink-0 border-t border-border/50 bg-card p-3", children: [_jsx("div", { className: "mb-1.5 flex items-center justify-center", "aria-hidden": "true", children: _jsx("span", { title: "\u62D6\u52A8\u8F93\u5165\u6846\u53F3\u4E0B\u89D2\u53EF\u8C03\u6574\u9AD8\u5EA6", className: "inline-flex h-1 w-8 rounded-full bg-border" }) }), _jsxs("div", { className: "flex items-end gap-2", children: [_jsx("textarea", { rows: 2, value: draftInput, onChange: (e) => setDraftInput(e.target.value), onKeyDown: handleKeyDown, placeholder: selectedGroup
                                                    ? `在项目组「${selectedGroup.name}」中执行... (⌘+Enter)`
                                                    : selectedProject
                                                        ? `在「${selectedProject.name}」中执行... (⌘+Enter)`
                                                        : "输入消息开始对话... (⌘+Enter)", className: "min-h-[60px] max-h-[200px] flex-1 resize-y rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm leading-snug text-foreground placeholder:text-muted-foreground transition-shadow focus:outline-none focus:ring-2 focus:ring-ring" }), _jsx("button", { type: "button", onClick: () => void handleSend(), disabled: !draftInput.trim() || chat.isSending, className: "flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-smooth hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:shadow-none", title: "\u53D1\u9001 (\u2318+Enter)", children: chat.isSending ? (_jsx("span", { className: "inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-current" })) : (_jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "M22 2 11 13" }), _jsx("path", { d: "M22 2 15 22l-4-9-9-4z" })] })) })] }), _jsxs("div", { className: "mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground", children: [_jsx("span", { children: selectedGroup
                                                    ? `项目组 · ${selectedGroup.name}`
                                                    : selectedProject
                                                        ? `项目 · ${selectedProject.name}`
                                                        : "纯对话模式" }), _jsx("span", { children: "\u2318 + \u21B5 \u53D1\u9001" })] })] })] })] }))] }));
}
//# sourceMappingURL=FloatingChat.js.map