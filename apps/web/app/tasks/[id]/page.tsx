"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Badge,
  Card,
  CardContent,
} from "@tide/ui";
import {
  useTaskQuery,
  useStopTaskMutation,
  useRetryTaskMutation,
} from "@tide/core";
import { ApprovalPanel } from "@tide/views";

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

const STATUS_DOT: Record<string, string> = {
  queued: "bg-zinc-400",
  running: "bg-emerald-500",
  review: "bg-amber-500",
  completed: "bg-zinc-900",
  failed: "bg-red-600",
  stopped: "bg-zinc-500",
  approved: "bg-zinc-900",
  rejected: "bg-red-600",
};

function formatFull(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

function formatShort(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** 把毫秒转成中文人性化字符串：2小时5分钟、3分钟12秒、47秒、820ms */
function humanizeDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms} 毫秒`;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (minutes) parts.push(`${minutes} 分`);
  if (!days && !hours && seconds) parts.push(`${seconds} 秒`);
  if (parts.length === 0) return `${seconds} 秒`;
  return parts.slice(0, 2).join(" ");
}

/** 计算耗时（ms）。若后端给了 duration_ms 则用之；否则按 started/completed 推算；
 * 若任务仍在运行则用 created/started → 现在。*/
function computeDurationMs(task: {
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  status: string;
}, nowTick: number): number | null {
  if (typeof task.duration_ms === "number" && task.duration_ms >= 0) {
    return task.duration_ms;
  }
  const startStr = task.started_at || task.created_at;
  if (!startStr) return null;
  const start = Date.parse(startStr);
  if (Number.isNaN(start)) return null;
  const endStr = task.completed_at;
  let end: number;
  if (endStr) {
    end = Date.parse(endStr);
    if (Number.isNaN(end)) return null;
  } else if (task.status === "running" || task.status === "queued") {
    end = nowTick;
  } else {
    return null;
  }
  return Math.max(0, end - start);
}

function parseAttachments(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function shortenId(id: string | null | undefined) {
  if (!id) return "—";
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/* ── 极简 Markdown 渲染（与 sessions 页一致的视觉语言） ─────────────── */
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
      <ul key={`l-${key}`} className="list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-zinc-800">
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
      <p key={i} className="text-[13.5px] leading-relaxed text-zinc-800">
        {renderInline(line)}
      </p>
    );
  });
  flushList(lines.length);
  return out;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const codeRegex = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = codeRegex.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`s-${k++}`}>{text.slice(last, m.index)}</span>);
    parts.push(
      <code key={`c-${k++}`} className="rounded bg-zinc-200/70 px-1 py-0.5 font-mono text-[12px] text-zinc-800">
        {m[1]}
      </code>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`t-${k++}`}>{text.slice(last)}</span>);
  return parts;
}

const RESULT_COLLAPSE_THRESHOLD = 1200;

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: task, isLoading, isError } = useTaskQuery(id);
  const stopMutation = useStopTaskMutation();
  const retryMutation = useRetryTaskMutation();

  const [resultExpanded, setResultExpanded] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);

  // 让"运行中"任务的耗时随时间走动
  const isLive = task?.status === "running" || task?.status === "queued";
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isLive) return;
    const handle = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [isLive]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="py-20 text-center text-sm text-muted-foreground">加载中…</div>
      </main>
    );
  }

  if (isError || !task) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="py-12 text-center text-sm text-destructive">
          任务不存在或加载失败
        </div>
        <div className="text-center">
          <Button variant="outline" onClick={() => router.push("/tasks")}>
            ← 返回任务列表
          </Button>
        </div>
      </main>
    );
  }

  const status = task.status as string;
  const canStop = status === "queued" || status === "running";
  const canRetry = status === "failed" || status === "stopped" || status === "rejected";
  const needsApproval = status === "review";
  const attachments = parseAttachments(task.attachments);

  const startTime = task.started_at || task.created_at;
  const durationMs = computeDurationMs(
    {
      duration_ms: task.duration_ms,
      started_at: task.started_at,
      completed_at: task.completed_at,
      created_at: task.created_at,
      status: String(task.status),
    },
    tick
  );

  const result = task.result || "";
  const resultLong = result.length > RESULT_COLLAPSE_THRESHOLD;
  const resultDisplay =
    resultLong && !resultExpanded
      ? result.slice(0, RESULT_COLLAPSE_THRESHOLD)
      : result;
  const resultLines = result ? result.split("\n").length : 0;

  const handleCopyResult = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setResultCopied(true);
      setTimeout(() => setResultCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      {/* ── Header ────────────────────────────────────── */}
      <header>
        <button
          onClick={() => router.push("/tasks")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-smooth"
        >
          ← 返回任务列表
        </button>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              任务详情
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wider">
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? "bg-zinc-400"} ${status === "running" ? "animate-pulse" : ""}`} />
                {STATUS_LABEL[status] ?? status}
              </span>
              {task.agent_id && (
                <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wider">
                  {task.agent_id}
                </span>
              )}
              {task.model && (
                <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wider">
                  {task.model}
                </span>
              )}
              <span className="font-mono text-[10px]">
                · ID {shortenId(task.id)} · 创建 {formatShort(task.created_at)}
              </span>
            </div>
          </div>
          <Badge variant={STATUS_VARIANT[status] ?? "outline"}>
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>
      </header>

      {/* ── Vital Stats: 开始时间 / 耗时 / 完成时间 ─────────── */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCell
          label="开始时间"
          primary={formatShort(startTime)}
          secondary={startTime === task.created_at && !task.started_at ? "（用创建时间近似）" : formatFull(startTime)}
        />
        <StatCell
          label="耗时"
          primary={humanizeDuration(durationMs)}
          secondary={
            isLive && durationMs != null
              ? "● 实时累计"
              : durationMs != null
                ? `${durationMs.toLocaleString()} ms`
                : "尚未开始"
          }
          highlight
          live={isLive && durationMs != null}
        />
        <StatCell
          label="完成时间"
          primary={formatShort(task.completed_at)}
          secondary={task.completed_at ? formatFull(task.completed_at) : "进行中…"}
        />
      </section>

      {/* ── Meta + Prompt ──────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div className="bg-card rounded-xl shadow-card p-6 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-medium">Prompt</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {task.prompt.length} chars
            </span>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-[12.5px] leading-relaxed text-foreground">
            {task.prompt}
          </pre>
        </div>

        <div className="bg-card rounded-xl shadow-card p-6 space-y-3">
          <span className="text-base font-medium">元信息</span>
          <MetaRow label="ID" value={task.id} mono small />
          <MetaRow label="工作目录" value={task.cwd ?? "—"} mono small />
          <MetaRow label="Session" value={task.session_id ?? "—"} mono small />
          <MetaRow label="Plan" value={task.plan_id ?? "—"} mono small />
          <MetaRow label="Branch" value={task.branch_name ?? "—"} mono small />
        </div>
      </section>

      {/* ── 附件 ────────────────────────────────────────── */}
      {attachments.length > 0 && (
        <div className="bg-card rounded-xl shadow-card p-6 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-medium">附件</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {attachments.length}
            </span>
          </div>
          <ul className="space-y-1.5 text-sm">
            {attachments.map((a) => (
              <li
                key={a}
                className="break-all rounded-lg bg-muted px-3 py-1.5 font-mono text-[11.5px] text-foreground"
              >
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 任务结果 ─────────────────────────────────────── */}
      {result && (
        <div className="bg-card rounded-xl shadow-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="text-base font-medium">运行结果</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {result.length.toLocaleString()} chars · {resultLines} lines
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyResult}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-smooth hover:text-foreground"
              >
                {resultCopied ? "已复制" : "复制"}
              </button>
              {resultLong && (
                <button
                  onClick={() => setResultExpanded((v) => !v)}
                  className="rounded-md bg-foreground px-2.5 py-1 text-xs text-background transition-smooth hover:opacity-90"
                >
                  {resultExpanded ? "收起" : "展开"}
                </button>
              )}
            </div>
          </div>
          <div className="relative">
            <div
              className={[
                "px-6 py-5",
                resultLong && !resultExpanded ? "max-h-[420px] overflow-hidden" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="space-y-2.5">
                {renderMarkdown(resultDisplay)}
              </div>
            </div>
            {resultLong && !resultExpanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-24 items-end justify-center bg-gradient-to-t from-card to-transparent pb-3">
                <button
                  onClick={() => setResultExpanded(true)}
                  className="pointer-events-auto rounded-md bg-card px-3 py-1.5 text-xs shadow-card transition-smooth hover:shadow-card-hover"
                >
                  展开剩余 {(result.length - RESULT_COLLAPSE_THRESHOLD).toLocaleString()} 字符
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Diff Summary（如果有） ───────────────────────── */}
      {task.diff_summary && (
        <div className="bg-card rounded-xl shadow-card p-6 space-y-3">
          <span className="text-base font-medium">Diff 概要</span>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-[12px] leading-relaxed text-foreground">
            {task.diff_summary}
          </pre>
        </div>
      )}

      {/* ── Approval ────────────────────────────────────── */}
      {needsApproval && (
        <ApprovalPanel taskId={task.id} reason={task.result} />
      )}

      {/* ── Actions ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 border-t border-border/50 pt-6">
        {canStop && (
          <Button
            variant="destructive"
            disabled={stopMutation.isPending}
            onClick={() => stopMutation.mutate(task.id)}
          >
            {stopMutation.isPending ? "停止中…" : "停止任务"}
          </Button>
        )}
        {canRetry && (
          <Button
            variant="outline"
            disabled={retryMutation.isPending}
            onClick={() => retryMutation.mutate(task.id)}
          >
            {retryMutation.isPending ? "重试中…" : "重试"}
          </Button>
        )}
        {task.session_id && (
          <Button
            variant="ghost"
            onClick={() => router.push(`/sessions/${task.session_id}`)}
          >
            查看会话 →
          </Button>
        )}
      </div>

      {(stopMutation.isError || retryMutation.isError) && (
        <p className="text-sm text-destructive">
          操作失败：{String(stopMutation.error || retryMutation.error)}
        </p>
      )}
    </main>
  );
}

/* ── Sub-components ────────────────────────────────── */

function StatCell({
  label,
  primary,
  secondary,
  highlight,
  live,
}: {
  label: string;
  primary: string;
  secondary?: string;
  highlight?: boolean;
  live?: boolean;
}) {
  return (
    <div
      className={[
        "relative rounded-xl bg-card p-5 transition-smooth",
        highlight ? "shadow-card-hover" : "shadow-card",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {live && (
          <span className="inline-flex items-center gap-1 text-[10px] tracking-widest text-emerald-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            LIVE
          </span>
        )}
      </div>
      <div
        className={[
          "mt-2 font-semibold tracking-tight text-foreground",
          highlight ? "text-2xl" : "text-lg",
        ].join(" ")}
      >
        {primary}
      </div>
      {secondary && (
        <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
          {secondary}
        </div>
      )}
    </div>
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
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span
        className={[
          "break-all text-foreground",
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
