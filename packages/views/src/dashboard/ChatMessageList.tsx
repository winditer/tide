"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatArtifact, ChatAttachment, ChatMessage } from "@tide/core";
import { extractArtifactsFromContent, appPath } from "@tide/core";
import { ExternalLink, FileText, X } from "lucide-react";
import { SimpleMarkdown } from "../shared/SimpleMarkdown";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function isImageAttachment(att: ChatAttachment): boolean {
  if (att.type === "image") return true;
  return IMAGE_RE.test(att.name || att.path || "");
}

function getAttachmentPreviewUrl(att: ChatAttachment): string {
  if (att.previewUrl) return att.previewUrl;
  const path = att.path || "";
  if (!path) return "";
  if (path.startsWith("/api/") || /^https?:/i.test(path)) return path;
  return `/api/tasks/attachments/content?path=${encodeURIComponent(path)}`;
}

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
          {message.content && (
            <pre className="whitespace-pre-wrap break-words font-sans">
              {message.content}
            </pre>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <UserAttachmentGrid attachments={message.attachments} />
          )}
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

        {/* Inline artifact cards: render only after the assistant message has
            settled (status=completed) to avoid flicker during streaming. */}
        <MessageArtifactCards message={message} />
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

// ─────────────────────────────────────────────────────────────────────────
// User message attachments rendering
// ─────────────────────────────────────────────────────────────────────────

function UserAttachmentGrid({ attachments }: { attachments: ChatAttachment[] }) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));

  useEffect(() => {
    if (!lightboxUrl) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxUrl]);

  return (
    <>
      {images.length > 0 && (
        <div
          className={
            "mt-2 grid gap-2 " +
            (images.length === 1 ? "grid-cols-1" : "grid-cols-2")
          }
        >
          {images.map((att) => {
            const url = getAttachmentPreviewUrl(att);
            return (
              <button
                key={att.id}
                type="button"
                onClick={() => setLightboxUrl(url)}
                className="relative overflow-hidden rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 transition-opacity hover:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={att.name || "图片"}
                  className="max-h-40 w-full object-cover"
                  loading="lazy"
                />
              </button>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((att) => (
            <a
              key={att.id}
              href={getAttachmentPreviewUrl(att)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-primary-foreground/10 px-2 py-1 text-xs text-primary-foreground hover:bg-primary-foreground/20"
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-[120px] truncate">{att.name || "附件"}</span>
            </a>
          ))}
        </div>
      )}

      {lightboxUrl && (
        <button
          type="button"
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div className="absolute right-4 top-4 text-white/80">
            <X className="h-6 w-6" />
          </div>
          <a
            href={lightboxUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="图片预览"
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            />
          </a>
        </button>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Inline artifact rendering — extracted from message content as supplementary
// signal to backend `task.artifact` events. Hidden until the message is
// fully settled to avoid flicker while content streams in.
// ─────────────────────────────────────────────────────────────────────────

function MessageArtifactCards({ message }: { message: ChatMessage }) {
  const artifacts = useMemo<ChatArtifact[]>(() => {
    if (message.role !== "assistant") return [];
    if (message.status !== "completed") return [];
    return extractArtifactsFromContent(message.content || "", message.taskId);
  }, [message.role, message.status, message.content, message.taskId]);

  if (artifacts.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {artifacts.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} />
      ))}
    </div>
  );
}

export function ArtifactCard({ artifact }: { artifact: ChatArtifact }) {
  const isExternal =
    artifact.type === "link" && /^https?:/i.test(artifact.url);
  const Icon = isExternal ? ExternalLink : FileText;
  const typeLabel =
    artifact.type === "markdown"
      ? "文档"
      : artifact.type === "link"
        ? "链接"
        : "文件";
  // 绝对文件路径（如 /Users/...）转为后端 API 读取
  const resolvedUrl =
    !isExternal && !artifact.url.startsWith("/api/") && artifact.url.startsWith("/")
      ? `/api/files/content?path=${encodeURIComponent(artifact.url)}`
      : artifact.url;
  const href = isExternal
    ? artifact.url
    : appPath(`/docs/view?url=${encodeURIComponent(resolvedUrl)}&title=${encodeURIComponent(artifact.label)}`);

  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className="group flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] transition-colors hover:border-primary/40 hover:bg-primary/5"
      title={artifact.url}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
      <span className="min-w-0 flex-1 truncate text-foreground">
        {artifact.label}
      </span>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {typeLabel}
      </span>
      <span className="shrink-0 text-[10px] font-medium text-primary opacity-80 group-hover:opacity-100">
        查看
      </span>
    </a>
  );
}


