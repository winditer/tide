"use client";

import { useState } from "react";
import type { ChatArtifact } from "@tide/core";
import { appPath } from "@tide/core";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Paperclip } from "lucide-react";
import { formatRelativeTime } from "./format-time";

interface ChatArtifactPanelProps {
  artifacts: ChatArtifact[];
}

/**
 * Collapsible summary panel that lists every artifact produced during the
 * current chat session. Hidden when there are no artifacts so the panel does
 * not occupy vertical space in the floating chat header.
 */
export function ChatArtifactPanel({ artifacts }: ChatArtifactPanelProps) {
  const [open, setOpen] = useState(false);

  if (!artifacts || artifacts.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border/50 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted/60"
        aria-expanded={open}
      >
        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">产物</span>
        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-medium text-primary">
          {artifacts.length}
        </span>
        <span className="ml-auto text-muted-foreground">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {open && (
        <ul className="max-h-48 space-y-1 overflow-y-auto border-t border-border/50 px-2 py-2">
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <ArtifactRow artifact={artifact} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ArtifactRow({ artifact }: { artifact: ChatArtifact }) {
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
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-muted"
      title={artifact.url}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
      <span className="min-w-0 flex-1 truncate text-foreground">
        {artifact.label}
      </span>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {typeLabel}
      </span>
      {artifact.created_at && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatRelativeTime(artifact.created_at)}
        </span>
      )}
      <span className="shrink-0 text-[10px] font-medium text-primary opacity-80 group-hover:opacity-100">
        查看
      </span>
    </a>
  );
}
