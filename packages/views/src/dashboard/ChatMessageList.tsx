"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@tide/core";
import { SimpleMarkdown } from "../shared/SimpleMarkdown";

interface ChatMessageListProps {
  messages: ChatMessage[];
  emptyHint?: string;
  onApprove?: (approvalId: string, comment?: string) => void;
  onReject?: (approvalId: string, comment?: string) => void;
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

export function ChatMessageList({ messages, emptyHint, onApprove, onReject }: ChatMessageListProps) {
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
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="text-xs text-muted-foreground">
            暂无对话
          </div>
          <div className="mt-1 text-sm text-foreground">
            {emptyHint || "输入消息开启对话"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-4"
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onApprove={onApprove} onReject={onReject} />
      ))}
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  onApprove?: (approvalId: string, comment?: string) => void;
  onReject?: (approvalId: string, comment?: string) => void;
}

function MessageBubble({ message, onApprove, onReject }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isPendingOrRunning =
    message.status === "pending" || message.status === "running";
  const isFailed = message.status === "failed";
  const hasApprovalPending =
    message.interactive?.type === "approval" &&
    message.interactive.status === "pending";
  const isApprovalResolved =
    message.interactive?.type === "approval" &&
    (message.interactive.status === "approved" ||
      message.interactive.status === "rejected");

  const [approvalComment, setApprovalComment] = useState("");
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const handleApproveClick = () => {
    setApprovalError(null);
    const id = message.interactive?.approvalId;
    if (!id) return;
    onApprove?.(id, approvalComment.trim() || undefined);
  };
  const handleRejectClick = () => {
    const id = message.interactive?.approvalId;
    if (!id) return;
    if (!approvalComment.trim()) {
      setApprovalError("拒绝时请填写审批意见");
      return;
    }
    setApprovalError(null);
    onReject?.(id, approvalComment.trim());
  };

  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm leading-relaxed text-primary-foreground shadow-sm">
          <pre className="whitespace-pre-wrap break-words font-sans">
            {message.content}
          </pre>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatTime(message.timestamp)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <div
        className={
          "max-w-[80%] rounded-2xl rounded-bl-md border px-4 py-2 text-sm leading-relaxed text-foreground shadow-sm " +
          (isFailed
            ? "border-destructive/40 bg-destructive/5"
            : hasApprovalPending
              ? "border-amber-300/60 bg-amber-50"
              : isPendingOrRunning
                ? "border-border/50 bg-card"
                : "border-border/50 bg-card")
        }
      >
        {isPendingOrRunning && !message.content ? (
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">
              执行中…
            </span>
          </div>
        ) : (
          <SimpleMarkdown
            source={message.content || ""}
            variant="compact"
            className="break-words text-sm leading-6"
          />
        )}

        {/* Interactive approval input + buttons */}
        {hasApprovalPending && message.interactive?.approvalId && (
          <div className="mt-2 space-y-2 border-t border-amber-200/60 pt-2">
            <textarea
              value={approvalComment}
              onChange={(e) => {
                setApprovalComment(e.target.value);
                if (approvalError) setApprovalError(null);
              }}
              rows={2}
              placeholder="审批意见（拒绝时必填）…"
              className="w-full resize-none rounded-md border border-amber-200/70 bg-white/80 px-2 py-1 text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            {approvalError && (
              <p className="text-[11px] text-destructive">{approvalError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleApproveClick}
                className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-600"
              >
                通过
              </button>
              <button
                type="button"
                onClick={handleRejectClick}
                className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                拒绝
              </button>
            </div>
          </div>
        )}

        {/* Resolved approval status badge */}
        {isApprovalResolved && (
          <div className="mt-2 border-t border-border/50 pt-2">
            <span
              className={
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium " +
                (message.interactive!.status === "approved"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-destructive/10 text-destructive")
              }
            >
              {message.interactive!.status === "approved"
                ? "✓ 已通过"
                : "✕ 已拒绝"}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{formatTime(message.timestamp)}</span>
        {message.status && (
          <span
            className={
              "rounded-md px-1.5 py-px text-[10px] font-medium " +
              (message.status === "completed"
                ? "bg-emerald-50 text-emerald-700"
                : message.status === "failed"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground")
            }
          >
            {message.status === "completed"
              ? "完成"
              : message.status === "failed"
                ? "失败"
                : message.status === "running"
                  ? "运行中"
                  : "等待中"}
          </span>
        )}
      </div>
    </div>
  );
}


