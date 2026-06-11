"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@tide/core";

interface ChatMessageListProps {
  messages: ChatMessage[];
  emptyHint?: string;
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function ChatMessageList({ messages, emptyHint }: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="flex h-full items-center justify-center px-4 py-6"
      >
        <div className="max-w-[260px] text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border-2 border-zinc-900 bg-yellow-300 shadow-[3px_3px_0_0_rgba(0,0,0,1)]">
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
          </div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
            EMPTY · CHAT
          </div>
          <div className="mt-1 text-sm text-zinc-700">
            {emptyHint || "输入消息开启对话"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex h-full flex-col gap-3 overflow-y-auto px-3 py-3"
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isPendingOrRunning =
    message.status === "pending" || message.status === "running";
  const isFailed = message.status === "failed";

  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[80%] rounded-xl border-2 border-zinc-900 bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-white shadow-[3px_3px_0_0_rgba(0,0,0,1)]">
          <pre className="whitespace-pre-wrap break-words font-sans">
            {message.content}
          </pre>
        </div>
        <div className="mt-1 font-mono text-[10px] tracking-widest text-zinc-400">
          {formatTime(message.timestamp)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <div
        className={
          "max-w-[80%] rounded-xl border-2 px-3 py-2 text-sm leading-relaxed text-zinc-900 shadow-[3px_3px_0_0_rgba(0,0,0,1)] " +
          (isFailed
            ? "border-red-500 bg-red-50"
            : isPendingOrRunning
              ? "border-zinc-900 bg-yellow-50"
              : "border-zinc-900 bg-zinc-100")
        }
      >
        {isPendingOrRunning && !message.content ? (
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-900" />
            <span className="font-mono text-[11px] tracking-widest text-zinc-700">
              EXECUTING…
            </span>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans">
            {renderContent(message.content)}
          </pre>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] tracking-widest text-zinc-400">
        <span>{formatTime(message.timestamp)}</span>
        {message.status && (
          <span
            className={
              "rounded border px-1 py-px " +
              (message.status === "completed"
                ? "border-emerald-500 text-emerald-600"
                : message.status === "failed"
                  ? "border-red-500 text-red-600"
                  : "border-zinc-400 text-zinc-500")
            }
          >
            {message.status.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Lightweight content renderer:
 * - Splits on triple-backtick fenced code blocks and renders them as <code> blocks
 * - Outside of code blocks, renders raw text (whitespace preserved by parent <pre>)
 */
function renderContent(content: string): React.ReactNode {
  if (!content) return null;
  const parts: React.ReactNode[] = [];
  const fenceRe = /```([\w-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = fenceRe.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before) parts.push(<span key={`t-${key++}`}>{before}</span>);
    const code = match[2] || "";
    parts.push(
      <code
        key={`c-${key++}`}
        className="my-1 block whitespace-pre-wrap break-words rounded border-2 border-zinc-900 bg-white px-2 py-1.5 font-mono text-[12px] text-zinc-900"
      >
        {code}
      </code>
    );
    lastIndex = match.index + match[0].length;
  }
  const tail = content.slice(lastIndex);
  if (tail) parts.push(<span key={`t-${key++}`}>{tail}</span>);
  return parts.length > 0 ? parts : content;
}
