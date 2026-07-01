"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
} from "@tide/ui";
import {
  useChat,
  useSessionQuery,
  type SessionMessage,
  type SessionRelatedTask,
} from "@tide/core";

const AGENT_LABEL: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  qoder: "Qoder",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "secondary",
  running: "default",
  review: "outline",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  approved: "secondary",
  rejected: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  review: "待审批",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  approved: "已批准",
  rejected: "已拒绝",
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatFull(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

function shortenId(id: string | null | undefined) {
  if (!id) return "—";
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/* Light-weight markdown renderer (no external deps).
   Supports: fenced code blocks, inline code, bold, italic, links, headings, lists. */
function renderMarkdown(src: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const fenceRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = fenceRegex.exec(src)) !== null) {
    if (match.index > lastIndex) {
      blocks.push(
        <div key={key++} className="space-y-2">
          {renderInlineBlock(src.slice(lastIndex, match.index))}
        </div>
      );
    }
    const lang = match[1] || "";
    const code = match[2].replace(/\n$/, "");
    blocks.push(
      <pre
        key={key++}
        className="max-w-full overflow-x-auto rounded-md border border-zinc-900/10 bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-zinc-100"
      >
        {lang && (
          <div className="mb-2 font-mono text-[10px] tracking-widest text-zinc-400">
            {lang.toUpperCase()}
          </div>
        )}
        <code>{code}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < src.length) {
    blocks.push(
      <div key={key++} className="space-y-2">
        {renderInlineBlock(src.slice(lastIndex))}
      </div>
    );
  }
  return blocks;
}

function renderInlineBlock(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = (key: number) => {
    if (listBuf.length === 0) return;
    out.push(
      <ul
        key={`l-${key}`}
        className="list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-zinc-800"
      >
        {listBuf.map((it, i) => (
          <li key={i}>{renderInline(it)}</li>
        ))}
      </ul>
    );
    listBuf = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    const listMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (listMatch) {
      listBuf.push(listMatch[1]);
      return;
    }
    flushList(i);
    if (!line.trim()) return;
    const headMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headMatch) {
      const level = headMatch[1].length;
      const content = headMatch[2];
      const cls =
        level <= 2
          ? "font-serif text-lg text-zinc-900"
          : "font-serif text-base text-zinc-900";
      out.push(
        <div key={i} className={cls}>
          {renderInline(content)}
        </div>
      );
      return;
    }
    out.push(
      <p key={i} className="text-[14px] leading-relaxed text-zinc-800">
        {renderInline(line)}
      </p>
    );
  });
  flushList(lines.length);
  return out;
}

function renderInline(text: string): React.ReactNode[] {
  // inline code first
  const parts: React.ReactNode[] = [];
  const codeRegex = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = codeRegex.exec(text)) !== null) {
    if (m.index > last) parts.push(...renderEmphasis(text.slice(last, m.index), k++));
    parts.push(
      <code
        key={`c-${k++}`}
        className="rounded bg-zinc-200/70 px-1 py-0.5 font-mono text-[12.5px] text-zinc-800"
      >
        {m[1]}
      </code>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(...renderEmphasis(text.slice(last), k++));
  return parts;
}

function renderEmphasis(text: string, baseKey: number): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  // Links [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = linkRegex.exec(text)) !== null) {
    if (m.index > last)
      result.push(...emphasisRun(text.slice(last, m.index), `${baseKey}-${k++}`));
    result.push(
      <a
        key={`a-${baseKey}-${k++}`}
        href={m[2]}
        target="_blank"
        rel="noreferrer"
        className="text-zinc-900 underline underline-offset-4"
      >
        {m[1]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length)
    result.push(...emphasisRun(text.slice(last), `${baseKey}-${k++}`));
  return result;
}

function emphasisRun(text: string, baseKey: string): React.ReactNode[] {
  // **bold** then *italic*
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`s-${baseKey}-${k++}`}>{text.slice(last, m.index)}</span>);
    if (m[2] !== undefined) {
      out.push(
        <strong key={`b-${baseKey}-${k++}`} className="font-semibold text-zinc-900">
          {m[2]}
        </strong>
      );
    } else if (m[3] !== undefined) {
      out.push(
        <em key={`i-${baseKey}-${k++}`} className="italic">
          {m[3]}
        </em>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length)
    out.push(<span key={`t-${baseKey}-${k++}`}>{text.slice(last)}</span>);
  return out;
}

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSessionQuery(id);

  const messages = data?.messages ?? [];
  const tasks = data?.tasks ?? [];
  const session = data?.session;

  // --- Chat input state & logic ---
  const chat = useChat();
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const sendingRef = useRef(false);
  const [draftInput, setDraftInput] = useState("");

  // Merge: API history messages + new chat messages
  const allMessages = useMemo(() => {
    if (chat.messages.length === 0) return messages;
    // Convert chat messages to SessionMessage format for display
    const newMsgs: SessionMessage[] = chat.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      timestamp: m.timestamp,
      kind: undefined,
    }));
    return [...messages, ...newMsgs];
  }, [messages, chat.messages]);

  const handleSend = useCallback(async () => {
    const trimmed = draftInput.trim();
    if (!trimmed) return;
    if (chatRef.current.isSending) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setDraftInput("");
    try {
      await chatRef.current.sendMessage(trimmed, {
        sessionId: session?.session_id,
        projectCwd: session?.cwd || undefined,
        agentId: session?.agent_id || undefined,
      });
    } finally {
      sendingRef.current = false;
    }
  }, [draftInput, session?.session_id, session?.cwd, session?.agent_id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages.length]);

  const projectName = useMemo(() => {
    if (!session) return "—";
    if (session.project_name) return session.project_name;
    const cwd = session.project_root || session.cwd;
    if (!cwd) return "—";
    const parts = cwd.replace(/\/$/, "").split("/");
    return parts[parts.length - 1] || cwd;
  }, [session]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2">
        <div className="py-20 text-center text-sm text-muted-foreground">加载中…</div>
      </main>
    );
  }

  if (isError || !session) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2 space-y-6">
        <div className="py-12 text-center text-sm text-destructive">
          会话不存在或加载失败
        </div>
        <div className="text-center">
          <Button variant="outline" onClick={() => router.push("/sessions")}>
            ← 返回会话列表
          </Button>
        </div>
      </main>
    );
  }

  const status = (session.status || session.last_status || "completed") as string;
  const title =
    session.title ||
    `Session ${shortenId(session.session_id)}`;

  return (
    <main className="mx-auto flex h-[calc(100vh-64px)] max-w-7xl flex-col px-2 py-2">
      {/* Header */}
      <header className="shrink-0">
        <button
          onClick={() => router.push("/sessions")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-smooth"
        >
          ← 返回会话列表
        </button>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono text-[11px]">{shortenId(session.session_id)}</span>
              <span className="text-muted-foreground/60">·</span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-muted-foreground">
                {projectName}
              </span>
              {session.agent_id && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-muted-foreground">
                  {AGENT_LABEL[session.agent_id] ?? session.agent_id}
                </span>
              )}
              <Badge variant={STATUS_VARIANT[status] ?? "outline"} className="text-[10px]">
                {STATUS_LABEL[status] ?? status}
              </Badge>
              <span className="text-muted-foreground/60">·</span>
              <span>最近活跃 {formatTime(session.last_active)}</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            刷新
          </Button>
        </div>
      </header>

      <div className="mt-6 grid min-w-0 flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Conversation */}
        <div className="flex min-w-0 flex-col bg-card rounded-xl shadow-card overflow-hidden">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-5 py-6"
          >
            {allMessages.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <span>暂无对话历史 — 会话文件可能尚未生成或无法读取</span>
              </div>
            ) : (
              <div className="space-y-4">
                {allMessages.map((m, idx) => (
                  <MessageBubble key={idx} message={m} />
                ))}
              </div>
            )}
          </div>

          {/* Chat input area */}
          <div className="shrink-0 border-t border-border/50 bg-card px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={draftInput}
                onChange={(e) => setDraftInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息继续对话... (⌘/Ctrl+Enter 发送)"
                className="min-h-[56px] max-h-[160px] flex-1 resize-y rounded-lg border border-border/50 bg-muted/50 px-3 py-2 text-sm leading-snug text-foreground placeholder:text-muted-foreground transition-shadow focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!draftInput.trim() || chat.isSending}
                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-smooth hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:shadow-none"
                title="发送 (⌘/Ctrl+Enter)"
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
            <div className="mt-1.5 text-right text-[10px] text-muted-foreground">
              ⌘/Ctrl + Enter 发送
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4 overflow-y-auto">
          <div className="bg-card rounded-xl shadow-card p-4 space-y-3">
            <h2 className="text-base font-medium">元信息</h2>
            <MetaRow label="Session" value={session.session_id} mono />
            <MetaRow label="Agent" value={AGENT_LABEL[session.agent_id ?? ""] ?? session.agent_id ?? "—"} />
            <MetaRow label="项目" value={projectName} />
            <MetaRow label="工作目录" value={session.cwd ?? "—"} mono small />
            <MetaRow label="创建时间" value={formatFull(session.created_at)} />
            <MetaRow label="最近活跃" value={formatFull(session.last_active)} />
            {session.file && (
              <MetaRow label="会话文件" value={session.file} mono small />
            )}
            <MetaRow label="来源" value={session.source ?? "—"} />
          </div>

          <div className="bg-card rounded-xl shadow-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">关联任务</h2>
              <span className="text-xs text-muted-foreground">{tasks.length}</span>
            </div>
            {tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">无关联任务</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <RelatedTaskRow key={t.id} task={t} />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function MetaRow({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={[
          "break-all",
          mono ? "font-mono" : "",
          small ? "text-[11px] text-muted-foreground" : "text-[13px]",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function RelatedTaskRow({ task }: { task: SessionRelatedTask }) {
  const status = task.status || "completed";
  return (
    <li>
      <a
        href={`/tasks/${task.id}`}
        className="block rounded-lg border border-border/50 p-2.5 hover:bg-muted/50 hover:border-border transition-smooth"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-[12.5px]">
            {task.prompt || "（无 prompt）"}
          </span>
          <Badge
            variant={STATUS_VARIANT[status] ?? "outline"}
            className="shrink-0 text-[10px]"
          >
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
          <span>{shortenId(task.id)}</span>
          <span>{formatTime(task.created_at)}</span>
        </div>
      </a>
    </li>
  );
}

function MessageBubble({ message }: { message: SessionMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isReasoning = message.kind === "reasoning";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[80%] rounded-md bg-muted px-3 py-2 text-center text-[11px] text-muted-foreground">
          [SYSTEM] {message.content}
        </div>
      </div>
    );
  }

  const labelTime = formatTime(message.timestamp);

  return (
    <div className={`flex min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="flex min-w-0 flex-col gap-1"
        style={{ maxWidth: "88%", width: "100%" }}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{isUser ? "User" : isReasoning ? "Reasoning" : "Assistant"}</span>
          <span className="text-muted-foreground/60">·</span>
          <span>{labelTime}</span>
        </div>
        <div
          className={[
            "rounded-xl px-4 py-3 text-[14px] leading-relaxed transition-smooth",
            isUser
              ? ""
              : isReasoning
                ? "bg-muted/60 text-muted-foreground border border-dashed border-border/50"
                : "bg-card border border-border/50",
          ].join(" ")}
          style={{
            maxWidth: "100%",
            ...(isUser
              ? { background: "var(--color-foreground)", color: "var(--color-background)" }
              : {}),
          }}
        >
          <div
            className="space-y-2 max-h-[500px] overflow-y-auto overflow-x-hidden"
            style={{ overflowWrap: "break-word" }}
          >
            {isUser ? (
              <p
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "break-word",
                  wordBreak: "break-all",
                }}
              >
                {message.content}
              </p>
            ) : (
              renderMarkdown(message.content)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
