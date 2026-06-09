"use client";

import { use, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
} from "@lark2codex/ui";
import {
  useSessionQuery,
  type SessionMessage,
  type SessionRelatedTask,
} from "@lark2codex/core";

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
        className="overflow-x-auto rounded-md border border-zinc-900/10 bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-zinc-100"
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

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
      <main className="mx-auto max-w-6xl">
        <div className="py-20 text-center text-sm text-muted-foreground">加载中…</div>
      </main>
    );
  }

  if (isError || !session) {
    return (
      <main className="mx-auto max-w-6xl space-y-6">
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
    <main className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <header className="border-b border-zinc-200 pb-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/sessions")}>
            ← 会话
          </Button>
          <span className="font-mono text-[10px] tracking-[0.32em] text-zinc-500">
            CHAT · {shortenId(session.session_id)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl tracking-tight text-zinc-900">
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-zinc-700">
                {projectName}
              </span>
              {session.agent_id && (
                <span className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-zinc-700">
                  {AGENT_LABEL[session.agent_id] ?? session.agent_id}
                </span>
              )}
              <Badge variant={STATUS_VARIANT[status] ?? "outline"} className="text-[10px]">
                {STATUS_LABEL[status] ?? status}
              </Badge>
              <span className="font-mono text-[10px] text-zinc-400">
                · 最近活跃 {formatTime(session.last_active)}
              </span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            刷新
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* Conversation */}
        <Card className="overflow-hidden">
          <div
            ref={scrollRef}
            className="max-h-[68vh] overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(24,24,27,0.04),transparent_60%)] px-5 py-6"
          >
            {messages.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <span className="font-mono text-[10px] tracking-widest text-zinc-400">
                  NO MESSAGES
                </span>
                <span>暂无对话历史 — 会话文件可能尚未生成或无法读取</span>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, idx) => (
                  <MessageBubble key={idx} message={m} />
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Sidebar */}
        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="font-mono text-[10px] tracking-[0.28em] text-zinc-500">
                META
              </div>
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
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[10px] tracking-[0.28em] text-zinc-500">
                  TASKS
                </div>
                <span className="font-mono text-[10px] text-zinc-400">
                  {tasks.length}
                </span>
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
            </CardContent>
          </Card>
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
      <span className="font-mono text-[10px] tracking-widest text-zinc-400">
        {label}
      </span>
      <span
        className={[
          "break-all text-zinc-800",
          mono ? "font-mono" : "",
          small ? "text-[11px]" : "text-[13px]",
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
        className="block rounded border border-zinc-200 bg-white p-2.5 transition hover:border-zinc-900 hover:shadow-[2px_2px_0_0_rgba(24,24,27,0.92)]"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-[12.5px] text-zinc-800">
            {task.prompt || "（无 prompt）"}
          </span>
          <Badge
            variant={STATUS_VARIANT[status] ?? "outline"}
            className="shrink-0 text-[10px]"
          >
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-zinc-400">
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
        <div className="max-w-[80%] rounded border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-center font-mono text-[11px] tracking-wide text-zinc-500">
          [SYSTEM] {message.content}
        </div>
      </div>
    );
  }

  const labelTime = formatTime(message.timestamp);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[78%] flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`flex items-center gap-2 font-mono text-[10px] tracking-widest ${
            isUser ? "text-zinc-500" : "text-zinc-500"
          }`}
        >
          <span>{isUser ? "USER" : isReasoning ? "REASONING" : "ASSISTANT"}</span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-400">{labelTime}</span>
        </div>
        <div
          className={[
            "rounded-md px-4 py-3 text-[14px] leading-relaxed shadow-[2px_2px_0_0_rgba(24,24,27,0.08)]",
            isUser
              ? "border border-zinc-900 bg-zinc-900 text-zinc-50"
              : isReasoning
                ? "border border-dashed border-zinc-300 bg-zinc-50 text-zinc-700"
                : "border border-zinc-200 bg-white text-zinc-900",
          ].join(" ")}
        >
          <div
            className={
              isUser ? "prose-invert space-y-2" : "space-y-2"
            }
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              renderMarkdown(message.content)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
