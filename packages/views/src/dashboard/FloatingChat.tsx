"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useAgents, useChat, useProjects } from "@tide/core";
import { ChatMessageList } from "./ChatMessageList";

interface ButtonPosition {
  /** distance from viewport bottom in px */
  bottom: number;
  /** distance from viewport right in px */
  right: number;
}

const DEFAULT_POSITION: ButtonPosition = { bottom: 24, right: 24 };
const POSITION_STORAGE_KEY = "tide.floating-chat.position";
const PROJECT_STORAGE_KEY = "tide.floating-chat.project";
const AGENT_STORAGE_KEY = "tide.floating-chat.agent";
const BUTTON_SIZE = 56;
const DRAG_THRESHOLD = 4;
const WINDOW_W = 380;
const WINDOW_H = 520;
const MIN_W = 320;
const MIN_H = 400;
const MAX_W_VW = 0.9;
const MAX_H_VH = 0.85;

function loadPosition(): ButtonPosition {
  if (typeof window === "undefined") return DEFAULT_POSITION;
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return DEFAULT_POSITION;
    const parsed = JSON.parse(raw) as Partial<ButtonPosition>;
    return {
      bottom:
        typeof parsed.bottom === "number" ? parsed.bottom : DEFAULT_POSITION.bottom,
      right:
        typeof parsed.right === "number" ? parsed.right : DEFAULT_POSITION.right,
    };
  } catch {
    return DEFAULT_POSITION;
  }
}

function savePosition(pos: ButtonPosition) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

function readLocal(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeLocal(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function FloatingChat() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ButtonPosition>(DEFAULT_POSITION);
  const [projectCwd, setProjectCwd] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [draftInput, setDraftInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: WINDOW_W, height: WINDOW_H });

  // hydrate
  useEffect(() => {
    setMounted(true);
    setPosition(loadPosition());
    setProjectCwd(readLocal(PROJECT_STORAGE_KEY));
    setAgentId(readLocal(AGENT_STORAGE_KEY));
  }, []);

  useEffect(() => {
    if (mounted) writeLocal(PROJECT_STORAGE_KEY, projectCwd);
  }, [projectCwd, mounted]);

  useEffect(() => {
    if (mounted) writeLocal(AGENT_STORAGE_KEY, agentId);
  }, [agentId, mounted]);

  const projectsQuery = useProjects();
  const projects = projectsQuery.data?.projects ?? [];
  const { data: agentsData } = useAgents();
  const agents = agentsData?.agents ?? [];

  const selectedProject = useMemo(
    () => projects.find((p) => p.cwd === projectCwd) ?? null,
    [projects, projectCwd]
  );

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
    if (!trimmed) return;
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
        agentId: agentId || undefined,
      });
    } finally {
      sendingRef.current = false;
    }
  }, [draftInput, projectCwd, agentId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  // Drag handling
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startBottom: number;
    startRight: number;
    moved: boolean;
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startBottom: position.bottom,
        startRight: position.right,
        moved: false,
      };
    },
    [position]
  );

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      const state = dragStateRef.current;
      if (!state) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (
        !state.moved &&
        Math.abs(dx) < DRAG_THRESHOLD &&
        Math.abs(dy) < DRAG_THRESHOLD
      ) {
        return;
      }
      state.moved = true;
      setIsDragging(true);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nextRight = Math.min(
        Math.max(state.startRight - dx, 8),
        vw - BUTTON_SIZE - 8
      );
      const nextBottom = Math.min(
        Math.max(state.startBottom - dy, 8),
        vh - BUTTON_SIZE - 8
      );
      setPosition({ bottom: nextBottom, right: nextRight });
    }
    function handleUp() {
      const state = dragStateRef.current;
      if (!state) return;
      dragStateRef.current = null;
      if (state.moved) {
        // commit position; click suppressed via isDragging guard
        setIsDragging(false);
        setPosition((cur) => {
          savePosition(cur);
          return cur;
        });
      } else {
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
    if (isDragging) return;
    const next = !open;
    setOpen(next);
    if (next) chatRef.current.markRead();
  }, [open, isDragging]);

  // --- Resize drag logic ---
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  useEffect(() => {
    function onResizeMove(e: MouseEvent) {
      const s = resizeRef.current;
      if (!s) return;
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

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: windowSize.width,
        startH: windowSize.height,
      };
    },
    [windowSize]
  );

  // Compute window position so it stays anchored above the button and on screen
  const windowStyle = useMemo<CSSProperties>(() => {
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

  if (!mounted) return null;

  const unread = chat.hasUnread && !open;

  return (
    <>
      {/* Floating Button */}
      <button
        type="button"
        aria-label={open ? "关闭对话" : "打开对话"}
        onMouseDown={handleMouseDown}
        onClick={handleButtonClick}
        style={{ bottom: position.bottom, right: position.right }}
        className={
          "fixed z-50 flex h-14 w-14 items-center justify-center rounded-full border-2 border-zinc-900 bg-white text-zinc-900 shadow-[4px_4px_0_0_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5 active:translate-y-0 " +
          (isDragging ? "cursor-grabbing" : "cursor-grab")
        }
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unread && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-zinc-900 bg-red-500" />
        )}
      </button>

      {/* Chat Window */}
      {open && (
        <div
          style={windowStyle}
          className="fixed z-50 flex flex-col rounded-xl border-2 border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(0,0,0,1)]"
        >
          {/* Resize handle – top-left corner */}
          {!isMaximized && (
            <div
              onMouseDown={handleResizeMouseDown}
              className="absolute -left-0.5 -top-0.5 z-10 flex h-5 w-5 cursor-nw-resize items-end justify-end"
              title="拖动调整大小"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" className="text-zinc-400">
                <path d="M0 10 L10 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M0 6 L6 0" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          )}
          <div
            style={
              isMaximized
                ? { width: "100%", height: "100%" }
                : { width: windowSize.width, height: windowSize.height }
            }
            className="flex flex-col overflow-hidden rounded-[10px]"
          >
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b-2 border-zinc-900 bg-yellow-300 px-3">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-mono text-[11px] font-semibold tracking-[0.25em] text-zinc-900">
                  CHAT
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={chat.clearHistory}
                  title="清空历史"
                  className="flex h-7 w-7 items-center justify-center rounded border-2 border-zinc-900 bg-white text-zinc-900 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setIsMaximized((v) => !v)}
                  title={isMaximized ? "还原" : "最大化"}
                  className="flex h-7 w-7 items-center justify-center rounded border-2 border-zinc-900 bg-white text-zinc-900 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  {isMaximized ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="5" y="5" width="14" height="14" rx="1" />
                      <path d="M9 3v2" />
                      <path d="M15 3v2" />
                      <path d="M9 19v2" />
                      <path d="M15 19v2" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="关闭"
                  className="flex h-7 w-7 items-center justify-center rounded border-2 border-zinc-900 bg-white text-zinc-900 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Context bar */}
            <div className="flex shrink-0 items-center gap-2 border-b-2 border-zinc-900 bg-zinc-50 px-3 py-2">
              <select
                value={projectCwd}
                onChange={(e) => setProjectCwd(e.target.value)}
                className="h-7 max-w-[170px] flex-1 truncate rounded border-2 border-zinc-900 bg-white px-2 font-mono text-[11px] tracking-wider text-zinc-900 focus:outline-none focus:ring-2 focus:ring-yellow-300"
              >
                <option value="">CHAT · 无项目</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.cwd}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="h-7 w-[110px] rounded border-2 border-zinc-900 bg-white px-2 font-mono text-[11px] tracking-wider text-zinc-900 focus:outline-none focus:ring-2 focus:ring-yellow-300"
              >
                <option value="">AUTO</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-hidden bg-zinc-50">
              <ChatMessageList
                messages={chat.messages}
                emptyHint={
                  selectedProject
                    ? `在「${selectedProject.name}」中执行任务`
                    : "纯对话模式 · 不绑定项目"
                }
                onApprove={(approvalId) => void chat.approveTask(approvalId)}
                onReject={(approvalId) => void chat.rejectTask(approvalId)}
              />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t-2 border-zinc-900 bg-white p-2">
              <div className="mb-1 flex items-center justify-center" aria-hidden="true">
                <span
                  title="拖动输入框右下角可调整高度"
                  className="inline-flex h-1 w-8 rounded-full bg-zinc-300"
                />
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    selectedProject
                      ? `在「${selectedProject.name}」中执行... (⌘+Enter)`
                      : "输入消息开始对话... (⌘+Enter)"
                  }
                  className="min-h-[60px] max-h-[200px] flex-1 resize-y rounded border-2 border-zinc-900 bg-white px-2 py-1.5 text-sm leading-snug text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!draftInput.trim() || chat.isSending}
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded border-2 border-zinc-900 bg-zinc-900 text-white shadow-[3px_3px_0_0_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none disabled:hover:translate-y-0"
                  title="发送 (⌘+Enter)"
                >
                  {chat.isSending ? (
                    <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-current" />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M22 2 11 13" />
                      <path d="M22 2 15 22l-4-9-9-4z" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between font-mono text-[10px] tracking-widest text-zinc-400">
                <span>
                  {selectedProject
                    ? `PROJECT · ${selectedProject.name}`
                    : "CHAT MODE"}
                </span>
                <span>⌘ + ↵ SEND</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
