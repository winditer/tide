"use client";

/**
 * 工作项共享上下文面板 - 时间线展示协作记忆。
 *
 * Features:
 * - 时间线展示所有上下文条目
 * - 分类标签（进度更新 / 决策记录 / 交接说明）
 * - "添加记录"表单
 */

import { useState } from "react";
import { MessageSquarePlus, ChevronDown } from "lucide-react";
import { Button, Select } from "@tide/ui";
import type { WorkItemContextEntry } from "@tide/core";

export interface SharedContextPanelProps {
  workItemId: string;
  contextEntries: WorkItemContextEntry[];
  onAddContext?: (contextType: string, content: string) => void;
  currentUserId?: string;
}

const TYPE_META: Record<string, { label: string; className: string; dot: string }> = {
  summary: {
    label: "摘要",
    className: "bg-purple-100 text-purple-700",
    dot: "bg-purple-500",
  },
  decision: {
    label: "决策记录",
    className: "bg-blue-100 text-blue-700",
    dot: "bg-blue-500",
  },
  progress: {
    label: "进度更新",
    className: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
  },
  handover: {
    label: "交接说明",
    className: "bg-orange-100 text-orange-700",
    dot: "bg-orange-500",
  },
};

const TYPE_OPTIONS = [
  { value: "progress", label: "进度更新" },
  { value: "decision", label: "决策记录" },
  { value: "handover", label: "交接说明" },
  { value: "summary", label: "摘要" },
];

function formatTime(iso: string | null | undefined): string {
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

export function SharedContextPanel({
  workItemId,
  contextEntries,
  onAddContext,
  currentUserId,
}: SharedContextPanelProps) {
  const [contextType, setContextType] = useState("progress");
  const [content, setContent] = useState("");
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = () => {
    if (!content.trim() || !onAddContext) return;
    onAddContext(contextType, content.trim());
    setContent("");
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <span>
          共享上下文
          {contextEntries.length > 0 ? ` (${contextEntries.length})` : ""}
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>

      {expanded && (
        <div className="mt-3">
      {contextEntries.length > 0 ? (
        <div className="relative space-y-3 pl-4">
          {/* 时间线竖线 */}
          <div className="absolute bottom-1 left-[5px] top-1 w-px bg-border/60" />
          {contextEntries.map((entry) => {
            const meta = TYPE_META[entry.context_type] ?? {
              label: entry.context_type,
              className: "bg-zinc-100 text-zinc-600",
              dot: "bg-zinc-400",
            };
            return (
              <div key={entry.id} className="relative">
                {/* 时间线节点 */}
                <span
                  className={`absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background ${meta.dot}`}
                />
                <div className="rounded-lg border border-border/50 bg-card p-3 shadow-card">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {entry.author_name || entry.author_id}
                    </span>
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                      {formatTime(entry.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {entry.content}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
          暂无协作记录
        </div>
      )}

      {/* 添加记录表单 */}
      {onAddContext && (
        <div className="mt-3 space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">添加记录</span>
            <Select
              options={TYPE_OPTIONS}
              value={contextType}
              onChange={(e) => setContextType(e.target.value)}
              className="ml-auto h-8 w-32 text-xs"
            />
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder="记录进度、决策或交接说明…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!content.trim()}
              className="h-7 px-3 text-xs"
            >
              提交
            </Button>
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
}
