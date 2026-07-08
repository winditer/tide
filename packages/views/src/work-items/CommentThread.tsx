"use client";

/**
 * 工作项评论线程（freeform 协作核心交互）。
 *
 * - 气泡样式展示评论列表（作者 + 内容 + 时间）
 * - 底部使用 MentionInput，@提及专家团/小队触发 Agent 执行
 * - 关联任务的评论：订阅 WebSocket `task.output` 显示流式进度
 * - task_status === 'blocked'：显示红色审批卡片 + 通过 / 拒绝按钮
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, AlertTriangle, CheckCircle2, XCircle, User, ExternalLink } from "lucide-react";
import { Button } from "@tide/ui";
import {
  useWs,
  useWorkItemComments,
  useCreateWorkItemComment,
  useApprovals,
  useApproveApproval,
  useRejectApproval,
  type WorkItemComment,
  type CommentTaskStatus,
  type MentionItem,
} from "@tide/core";
import { MentionInput } from "./MentionInput";

export interface CommentThreadProps {
  workItemId: string;
  projectId?: string;
  currentUserId?: string;
}

interface TaskEventLike {
  type?: string;
  task_id?: string;
  chunk?: string;
  payload?: { chunk?: string };
}

const STATUS_META: Record<
  CommentTaskStatus,
  { label: string; className: string }
> = {
  running: { label: "执行中", className: "bg-blue-100 text-blue-700" },
  blocked: { label: "等待审批", className: "bg-red-100 text-red-700" },
  completed: { label: "已完成", className: "bg-emerald-100 text-emerald-700" },
  failed: { label: "失败", className: "bg-red-100 text-red-700" },
  stopped: { label: "已停止", className: "bg-zinc-100 text-zinc-600" },
  rejected: { label: "已拒绝", className: "bg-orange-100 text-orange-700" },
  cancelled: { label: "已取消", className: "bg-zinc-100 text-zinc-600" },
};

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

export function CommentThread({
  workItemId,
  projectId,
  currentUserId,
}: CommentThreadProps) {
  const { data: comments } = useWorkItemComments(workItemId);
  const createComment = useCreateWorkItemComment();
  const { subscribe } = useWs();

  // 待审批列表：用于匹配 blocked 评论对应的 approval
  const { data: approvalsResp } = useApprovals({ status: "pending" });
  const approveMutation = useApproveApproval();
  const rejectMutation = useRejectApproval();

  // 累加各任务的流式输出：taskId -> 文本
  const [taskOutputs, setTaskOutputs] = useState<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const list = useMemo<WorkItemComment[]>(() => comments ?? [], [comments]);

  // 订阅 WebSocket task.output，累加对应任务输出
  useEffect(() => {
    const unsubscribe = subscribe((event: unknown) => {
      const ev = event as TaskEventLike;
      if (ev?.type !== "task.output" || !ev.task_id) return;
      const chunk =
        (typeof ev.chunk === "string" ? ev.chunk : "") ||
        (typeof ev.payload?.chunk === "string" ? ev.payload.chunk : "") ||
        "";
      const clean = chunk.trim();
      if (!clean) return;
      setTaskOutputs((prev) => {
        const prevText = prev[ev.task_id as string] || "";
        const sep = prevText && !prevText.endsWith("\n") ? "\n" : "";
        return { ...prev, [ev.task_id as string]: prevText + sep + clean };
      });
    });
    return () => unsubscribe();
  }, [subscribe]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [list.length, taskOutputs]);

  const handleSubmit = (content: string, mentions: MentionItem[]) => {
    createComment.mutate({ workItemId, content, mentions });
  };

  const findApproval = (taskId?: string | null) => {
    if (!taskId) return undefined;
    return (approvalsResp?.items ?? []).find((a) => a.task_id === taskId);
  };

  return (
    <div>
      <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        协作评论
      </div>

      {list.length > 0 ? (
        <div className="space-y-3">
          {list.map((c) => {
            const hasAgent = !!c.task_id;
            const status = c.task_status as CommentTaskStatus | null;
            const stream = c.task_id ? taskOutputs[c.task_id] : undefined;
            const isBlocked = status === "blocked";
            const approval = isBlocked ? findApproval(c.task_id) : undefined;
            const mentionNames = (c.mentions ?? [])
              .map((m) => m.name)
              .filter(Boolean) as string[];
            // 后端可能把 task_id 直接写入 content（历史数据），此时不展示裸 UUID
            const contentIsBareTaskId =
              hasAgent && !!c.task_id && c.content?.trim() === c.task_id;

            return (
              <div key={c.id} className="flex gap-2">
                {/* 头像 */}
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                    hasAgent
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {hasAgent ? (
                    <Bot className="h-4 w-4" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="rounded-lg border border-border/50 bg-card p-3 shadow-card">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-foreground">
                        {c.author_name ||
                          (c.author_id === "system"
                            ? "系统"
                            : c.author_id?.slice(0, 8))}
                      </span>
                      {mentionNames.map((n) => (
                        <span
                          key={n}
                          className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                        >
                          @{n}
                        </span>
                      ))}
                      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                        {formatTime(c.created_at)}
                      </span>
                    </div>
                    {!contentIsBareTaskId && (
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {c.content}
                      </p>
                    )}

                    {/* 关联任务：可点击查看执行详情，而非裸 task_id */}
                    {hasAgent && c.task_id && (
                      <div className="mt-2">
                        <a
                          href={`/tasks/${c.task_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          查看执行详情
                        </a>
                      </div>
                    )}

                    {/* Agent 执行状态 */}
                    {hasAgent && status && (
                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            STATUS_META[status]?.className ??
                            "bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {status === "running" && (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          {status === "blocked" && (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {STATUS_META[status]?.label ?? status}
                        </span>
                      </div>
                    )}

                    {/* 流式输出 */}
                    {hasAgent && stream && (
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border/40 bg-zinc-950 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-100">
                        {stream}
                      </pre>
                    )}
                  </div>

                  {/* Blocked 红色审批卡片 */}
                  {isBlocked && (
                    <div className="mt-2 rounded-lg border-2 border-red-400/70 bg-red-50 p-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
                        <AlertTriangle className="h-4 w-4" />
                        任务被阻塞，等待审批
                      </div>
                      <p className="mt-1 text-[11px] text-red-600/90">
                        Agent 请求执行需要人工确认的操作，请审批以继续。
                      </p>
                      <div className="mt-2.5 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            approval &&
                            approveMutation.mutate({
                              id: approval.id,
                              operatorId: currentUserId,
                            })
                          }
                          disabled={!approval || approveMutation.isPending}
                          className="h-7 gap-1 bg-emerald-600 px-3 text-xs hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          通过
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            approval &&
                            rejectMutation.mutate({
                              id: approval.id,
                              operatorId: currentUserId,
                            })
                          }
                          disabled={!approval || rejectMutation.isPending}
                          className="h-7 gap-1 border-red-300 px-3 text-xs text-red-700 hover:bg-red-100"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          拒绝
                        </Button>
                      </div>
                      {!approval && (
                        <p className="mt-2 text-[10px] text-red-500/80">
                          审批请求同步中…
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
          暂无评论，使用 @ 提及专家团触发协作
        </div>
      )}

      {/* 输入区域 */}
      <div className="mt-3">
        <MentionInput
          projectId={projectId}
          workItemId={workItemId}
          submitting={createComment.isPending}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
