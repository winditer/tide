"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  useAgents,
  useChat,
  useProjects,
  useProjectGroups,
  uploadTaskAttachments,
  type ChatAttachment,
} from "@tide/core";
import { ChatMessageList } from "./ChatMessageList";
import { ChatArtifactPanel } from "./ChatArtifactPanel";
import { AIOptimizeButton } from "../work-items/AIOptimizeButton";

interface ButtonPosition {
  /** distance from viewport bottom in px */
  bottom: number;
  /** distance from viewport right in px */
  right: number;
}

const DEFAULT_POSITION: ButtonPosition = { bottom: 24, right: 24 };
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

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MAX_CHAT_IMAGES = 10;
const MAX_CHAT_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_RE.test(file.name);
}

function genAttachmentId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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
  /** 统一作用域选择。编码："project:<cwd>" / "group:<id>" / ""。 */
  const [scopeValue, setScopeValue] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [draftInput, setDraftInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: WINDOW_W, height: WINDOW_H });
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // hydrate
  useEffect(() => {
    setMounted(true);
    setPosition(loadPosition());
    // 优先读新 key；以前只保存 cwd 的旧 key 按 project: 前缀迁移
    const newScope = readLocal(SCOPE_STORAGE_KEY);
    if (newScope) {
      setScopeValue(newScope);
    } else {
      const legacyCwd = readLocal(PROJECT_STORAGE_KEY);
      setScopeValue(legacyCwd ? `project:${legacyCwd}` : "");
    }
    setAgentId(readLocal(AGENT_STORAGE_KEY));
  }, []);

  useEffect(() => {
    if (mounted) writeLocal(SCOPE_STORAGE_KEY, scopeValue);
  }, [scopeValue, mounted]);

  useEffect(() => {
    if (mounted) writeLocal(AGENT_STORAGE_KEY, agentId);
  }, [agentId, mounted]);

  const projectsQuery = useProjects();
  const projects = projectsQuery.data?.projects ?? [];
  const groupsQuery = useProjectGroups();
  const groups = groupsQuery.data?.groups ?? [];
  const { data: agentsData } = useAgents();
  const agents = agentsData?.agents ?? [];
  // 防御性过滤：排除已禁用的 Agent。后端默认已过滤 enabled=0，
  // 这里再次排除 status==="disabled" 以防缓存或数据滞后。
  const selectableAgents = useMemo(
    () => agents.filter((a) => a.status !== "disabled"),
    [agents]
  );

  // 从统一 scope 解码出当前选择的项目 cwd 与项目组 id
  const projectCwd = scopeValue.startsWith("project:") ? scopeValue.slice(8) : "";
  const groupId = scopeValue.startsWith("group:") ? scopeValue.slice(6) : "";

  const selectedProject = useMemo(
    () => projects.find((p) => p.cwd === projectCwd) ?? null,
    [projects, projectCwd]
  );
  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === groupId) ?? null,
    [groups, groupId]
  );

  const chat = useChat({
    projectId: projectCwd || undefined,
    agentId: agentId || undefined,
  });

  // Keep a stable ref to chat to avoid stale closures & dependency instability
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const sendingRef = useRef(false);

  const addPendingFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const incoming = Array.from(files).filter(isImageFile);
      if (!incoming.length) {
        setImageUploadError("仅支持图片文件");
        return;
      }
      const oversized = incoming.find((f) => f.size > MAX_CHAT_IMAGE_SIZE);
      if (oversized) {
        setImageUploadError(`图片 ${oversized.name} 超过 10MB 上限`);
        return;
      }
      if (pendingAttachments.length + incoming.length > MAX_CHAT_IMAGES) {
        setImageUploadError(`最多上传 ${MAX_CHAT_IMAGES} 张图片`);
        return;
      }
      setImageUploadError(null);
      const newItems: PendingAttachment[] = incoming.map((file) => ({
        id: genAttachmentId(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setPendingAttachments((prev) => [...prev, ...newItems]);
    },
    [pendingAttachments.length]
  );

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleImagePick = (e: ChangeEvent<HTMLInputElement>) => {
    addPendingFiles(e.target.files);
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData.files;
    if (files && files.length > 0) {
      const images = Array.from(files).filter(isImageFile);
      if (images.length > 0) {
        e.preventDefault();
        addPendingFiles(files);
      }
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    addPendingFiles(e.dataTransfer.files);
  };

  const handleSend = useCallback(async () => {
    const trimmed = draftInput.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    if (chatRef.current.isSending || isUploadingImages) {
      console.warn("[FloatingChat] Blocked: chat.isSending or uploading images");
      return;
    }
    if (sendingRef.current) {
      console.warn("[FloatingChat] Blocked: sendingRef active");
      return;
    }
    sendingRef.current = true;
    setDraftInput("");
    try {
      let messageAttachments: ChatAttachment[] | undefined;
      if (pendingAttachments.length > 0) {
        setIsUploadingImages(true);
        const files = pendingAttachments.map((a) => a.file);
        const res = await uploadTaskAttachments(files);
        messageAttachments = files.map((file, idx) => ({
          id: genAttachmentId(),
          path: res.attachments[idx] ?? "",
          name: file.name,
          type: "image" as const,
        }));
        pendingAttachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
        setPendingAttachments([]);
        setIsUploadingImages(false);
      }
      await chatRef.current.sendMessage(trimmed, {
        projectCwd: projectCwd || undefined,
        groupId: groupId || undefined,
        agentId: agentId || undefined,
        attachments: messageAttachments,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "图片上传失败";
      setImageUploadError(errMsg);
    } finally {
      setIsUploadingImages(false);
      sendingRef.current = false;
    }
  }, [draftInput, projectCwd, groupId, agentId, pendingAttachments, isUploadingImages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  // 释放未发送图片的预览 URL
  useEffect(() => {
    return () => {
      pendingAttachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          "fixed z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-smooth hover:scale-105 hover:shadow-xl " +
          (isDragging ? "cursor-grabbing" : "cursor-grab")
        }
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unread && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border-2 border-background bg-destructive" />
        )}
      </button>

      {/* Chat Window */}
      {open && (
        <div
          style={windowStyle}
          className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl"
        >
          {/* Resize handle – top-left corner */}
          {!isMaximized && (
            <div
              onMouseDown={handleResizeMouseDown}
              className="absolute left-1 top-1 z-10 flex h-4 w-4 cursor-nw-resize items-end justify-end opacity-40 transition-opacity hover:opacity-90"
              title="拖动调整大小"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" className="text-zinc-50">
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
            className="flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 bg-[hsl(224_71%_4%)] px-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                <span className="text-[13px] font-medium tracking-wide text-white">
                  Chat
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    chat.clearHistory();
                    chat.clearArtifacts();
                  }}
                  title="清空历史"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
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
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
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
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
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
            <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-card px-3 py-2">
              <select
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                className="h-7 max-w-[170px] flex-1 truncate rounded-md border border-border/50 bg-muted/50 px-2 text-xs text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                <option value="">无项目 · 纯对话</option>
                {projects.length > 0 && (
                  <optgroup label="项目">
                    {projects.map((p) => (
                      <option key={p.id} value={`project:${p.cwd}`}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {groups.length > 0 && (
                  <optgroup label="项目组">
                    {groups.map((g) => (
                      <option key={g.id} value={`group:${g.id}`}>
                        {g.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="h-7 w-[110px] rounded-md border border-border/50 bg-muted/50 px-2 text-xs text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                <option value="">自动</option>
                {selectableAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Artifacts panel — hidden when no artifacts produced. */}
            <ChatArtifactPanel artifacts={chat.artifacts} />

            {/* Messages */}
            <div className="flex-1 overflow-hidden bg-background">
              <ChatMessageList
                messages={chat.messages}
                emptyHint={
                  selectedGroup
                    ? `在项目组「${selectedGroup.name}」中执行任务`
                    : selectedProject
                      ? `在「${selectedProject.name}」中执行任务`
                      : "纯对话模式 · 不绑定项目"
                }
                onApprove={(approvalId, comment) => void chat.approveTask(approvalId, comment)}
                onReject={(approvalId, comment) => void chat.rejectTask(approvalId, comment)}
              />
            </div>

            {/* Input */}
            <div
              className={
                "shrink-0 border-t border-border/50 bg-card p-3 transition-shadow " +
                (dragActive ? "ring-2 ring-inset ring-primary/40" : "")
              }
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="mb-1.5 flex items-center justify-center" aria-hidden="true">
                <span
                  title="拖动输入框右下角可调整高度"
                  className="inline-flex h-1 w-8 rounded-full bg-border"
                />
              </div>

              {pendingAttachments.length > 0 && (
                <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                  {pendingAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="group relative h-8 w-8 shrink-0 overflow-hidden rounded border border-border/50 bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={att.previewUrl}
                        alt="待发送图片"
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(att.id)}
                        className="absolute right-0 top-0 flex h-3 w-3 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        title="移除"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="8"
                          height="8"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-1.5">
                <div className="relative flex-1">
                  <textarea
                    rows={2}
                    value={draftInput}
                    onChange={(e) => setDraftInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={
                      selectedGroup
                        ? `在项目组「${selectedGroup.name}」中执行... (⌘+Enter，可粘贴/拖拽图片)`
                        : selectedProject
                          ? `在「${selectedProject.name}」中执行... (⌘+Enter，可粘贴/拖拽图片)`
                          : "输入消息开始对话... (⌘+Enter，可粘贴/拖拽图片)"
                    }
                    className="min-h-[60px] max-h-[200px] w-full resize-y rounded-lg border-0 bg-muted/50 px-3 py-2 pr-10 text-sm leading-snug text-foreground placeholder:text-muted-foreground transition-shadow focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <AIOptimizeButton
                    description={draftInput}
                    onOptimized={setDraftInput}
                    disabled={!draftInput.trim()}
                    inline
                  />
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleImagePick}
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isUploadingImages || chat.isSending}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-smooth hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
                  title="发送图片"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={
                    (!draftInput.trim() && pendingAttachments.length === 0) ||
                    chat.isSending ||
                    isUploadingImages
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-smooth hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:shadow-none"
                  title="发送 (⌘+Enter)"
                >
                  {chat.isSending || isUploadingImages ? (
                    <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-current" />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
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
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {selectedGroup
                    ? `项目组 · ${selectedGroup.name}`
                    : selectedProject
                      ? `项目 · ${selectedProject.name}`
                      : "纯对话模式"}
                </span>
                <span className="flex items-center gap-2">
                  <span>⌘ + ↵ 发送</span>
                </span>
              </div>
              {imageUploadError && (
                <p className="mt-1.5 text-[11px] text-destructive">{imageUploadError}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
