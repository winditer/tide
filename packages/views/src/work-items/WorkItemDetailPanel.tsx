"use client";


import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Pencil, Trash2, AlertTriangle, GitMerge, GitBranch, Maximize2, Minimize2, CheckCircle2, ArrowRight, Clock, X, Link2, Check, Upload, FileText, Paperclip } from "lucide-react";
import { Button, Badge, Input, Select, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@tide/ui";
import { AIOptimizeButton } from "./AIOptimizeButton";
import { CommentThread } from "./CommentThread";
import { SharedContextPanel } from "./SharedContextPanel";
import {
  useWorkItem,
  useWorkItemTransitions,
  useUpdateWorkItem,
  useDeleteWorkItem,
  useWorkflow,
  useVersions,
  useProjectMembers,
  useApprovals,
  useApproveApproval,
  useRejectApproval,
  parseApprovalDetail,
  useAddArtifact,
  useRemoveArtifact,
  useAuth,
  useWorkItemContext,
  useAddWorkItemContext,
  uploadWorkItemAttachments,
  deleteWorkItemAttachment,
  useDeleteWorkItemAttachment,
  appPath,
  type WorkItem,
  type WorkItemUpdate,
  type WorkItemTransition,
  type WorkItemArtifact,
  type WorkItemPlanTask,
  type Approval,
  type WorkItemAttachment,
} from "@tide/core";
import { useQueryClient } from "@tanstack/react-query";
import { CrossRepoResults } from "./CrossRepoResults";
import { MergeConflictPanel } from "../code-editor/MergeConflictPanel";

const TERMINAL_STATUSES = new Set(["completed", "stopped"]);

const EDIT_IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MAX_EDIT_ATTACHMENTS = 10;
const MAX_EDIT_FILE_SIZE = 20 * 1024 * 1024; // 20MB

interface EditPendingAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

function isEditImageFile(file: File): boolean {
  return file.type.startsWith("image/") || EDIT_IMAGE_RE.test(file.name);
}

function genEditAttachmentId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const TASK_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  review: "待审批",
  completed: "已完成",
  failed: "失败",
  rejected: "已拒绝",
  stopped: "已停止",
  cancelled: "已取消",
};

const TASK_STATUS_COLOR: Record<string, string> = {
  queued: "bg-slate-400",
  running: "bg-amber-500 animate-pulse",
  review: "bg-violet-500",
  completed: "bg-emerald-600",
  failed: "bg-rose-600",
  rejected: "bg-rose-500",
  stopped: "bg-zinc-500",
  cancelled: "bg-zinc-500",
};

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "无" },
  { value: "1", label: "低" },
  { value: "2", label: "中" },
  { value: "3", label: "高" },
  { value: "4", label: "紧急" },
];

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** 从 transition.output 中尝试解析 session_id（兼容 JSON 与文本两种格式） */
function extractSessionId(output: string | null | undefined): string | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === "object" && typeof parsed.session_id === "string") {
      return parsed.session_id;
    }
  } catch {
    // not JSON, fall through
  }
  const m = output.match(/session[_-]?id["'\s:=]+([0-9a-fA-F-]{8,})/);
  return m ? m[1] : null;
}

interface WorkItemDetailPanelProps {
  itemId: string;
  onClose: () => void;
}

export function WorkItemDetailPanel({
  itemId,
  onClose,
}: WorkItemDetailPanelProps) {
  const queryClient = useQueryClient();
  const { data: item, isLoading } = useWorkItem(itemId);
  const { data: transitions } = useWorkItemTransitions(itemId);
  const { data: workflow } = useWorkflow(item?.workflow_id || "");
  const { data: versions } = useVersions(item?.project_id);
  const { data: membersData } = useProjectMembers(item?.project_id);
  const { user } = useAuth();
  const isViewer = user?.role === "viewer";
  const updateMutation = useUpdateWorkItem();
  const deleteMutation = useDeleteWorkItem();

  const nodeNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of workflow?.definition?.nodes ?? []) {
      const label = (n.data?.label as string | undefined) || n.id;
      map[n.id] = label;
    }
    return map;
  }, [workflow]);

  const versionOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "", label: "未关联" },
    ];
    for (const v of versions ?? []) {
      const suffix =
        v.status === "released"
          ? " · 已发布"
          : v.status === "archived"
            ? " · 已归档"
            : "";
      opts.push({ value: v.id, label: `${v.name}${suffix}` });
    }
    // 兼容工作项已绑定但版本列表中不存在该版本的情况，避免回显成空
    if (item?.version_id && !opts.some((o) => o.value === item.version_id)) {
      opts.push({ value: item.version_id, label: item.version_id });
    }
    return opts;
  }, [versions, item?.version_id]);

  const assigneeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "", label: "未分配" },
    ];
    for (const m of membersData?.members ?? []) {
      const name = m.display_name || m.username;
      opts.push({ value: name, label: name });
    }
    // 兼容当前 assignee 不在成员列表中的情况，仍可回显
    if (item?.assignee && !opts.some((o) => o.value === item.assignee)) {
      opts.push({ value: item.assignee, label: item.assignee });
    }
    return opts;
  }, [membersData, item?.assignee]);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPendingAttachments, setEditPendingAttachments] = useState<EditPendingAttachment[]>([]);
  const [editImageError, setEditImageError] = useState<string | null>(null);
  const [editDragActive, setEditDragActive] = useState(false);
  const [editUploadingImages, setEditUploadingImages] = useState(false);
  const editImageInputRef = useRef<HTMLInputElement>(null);

  const isEnded = TERMINAL_STATUSES.has(item?.status ?? "");

  const startEditing = () => {
    if (!item || isEnded) return;
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditing(true);
  };

  const addEditFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const incoming = Array.from(files);
      if (!incoming.length) return;
      const oversized = incoming.find((f) => f.size > MAX_EDIT_FILE_SIZE);
      if (oversized) {
        setEditImageError(`文件 ${oversized.name} 超过 20MB 上限`);
        return;
      }
      if (editPendingAttachments.length + incoming.length > MAX_EDIT_ATTACHMENTS) {
        setEditImageError(`最多上传 ${MAX_EDIT_ATTACHMENTS} 个文件`);
        return;
      }
      setEditImageError(null);
      const newItems: EditPendingAttachment[] = incoming.map((file) => ({
        id: genEditAttachmentId(),
        file,
        previewUrl: isEditImageFile(file) ? URL.createObjectURL(file) : "",
      }));
      setEditPendingAttachments((prev) => [...prev, ...newItems]);
    },
    [editPendingAttachments.length],
  );

  const removeEditAttachment = useCallback((id: string) => {
    setEditPendingAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target && target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleEditImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    addEditFiles(e.target.files);
    e.target.value = "";
  };

  const handleEditDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setEditDragActive(true);
  };

  const handleEditDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setEditDragActive(false);
  };

  const handleEditDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setEditDragActive(false);
    addEditFiles(e.dataTransfer.files);
  };

  const handleEditPaste = (e: React.ClipboardEvent<HTMLDivElement | HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      addEditFiles(files);
    }
  };

  // 清理编辑附件 URL
  useEffect(() => {
    return () => {
      editPendingAttachments.forEach((a) => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveEdit = async () => {
    if (!item) return;
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        data: {
          title: editTitle.trim() || item.title,
          description: editDescription.trim() || undefined,
        },
      });
      if (editPendingAttachments.length > 0) {
        setEditUploadingImages(true);
        try {
          await uploadWorkItemAttachments(
            item.id,
            editPendingAttachments.map((a) => a.file),
          );
          editPendingAttachments.forEach((a) => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
          setEditPendingAttachments([]);
          // 上传完成后刷新工作项数据以展示新附件
          await queryClient.invalidateQueries({ queryKey: ["work-items"] });
        } catch (e) {
          setEditImageError(e instanceof Error ? e.message : "附件上传失败");
          setEditUploadingImages(false);
          return;
        } finally {
          setEditUploadingImages(false);
        }
      }
      setEditing(false);
    } catch {
      // updateMutation error is handled by react-query
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!confirm("确定删除该工作项？")) return;
    await deleteMutation.mutateAsync(item.id);
    onClose();
  };

  const handleFieldUpdate = (data: WorkItemUpdate) => {
    if (!item) return;
    updateMutation.mutate({ id: item.id, data });
  };

  const [isExpanded, setIsExpanded] = useState(false);

  if (isLoading || !item) {
    return (
      <PanelShell onClose={onClose} isExpanded={isExpanded} onToggleExpand={() => setIsExpanded(!isExpanded)} itemId={itemId}>
        <div className="py-12 text-center font-mono text-xs text-zinc-500">
          ◐ LOADING…
        </div>
      </PanelShell>
    );
  }

  const inlineSelectClass =
    "h-7 w-full rounded-md border border-border/50 bg-background px-2 py-0 text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";
  const fieldDisabled = updateMutation.isPending || isViewer || isEnded;

  return (
    <PanelShell onClose={onClose} isExpanded={isExpanded} onToggleExpand={() => setIsExpanded(!isExpanded)} itemId={itemId}>
      <div className="space-y-6">
        {/* Title area */}
        {editing ? (
          <div className="space-y-3">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="h-11 rounded-lg border-0 bg-muted/50 text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
            <div className="relative">
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                onPaste={handleEditPaste}
                rows={4}
                className="w-full rounded-lg border-0 bg-muted/50 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="描述（可粘贴文件）"
              />
              <AIOptimizeButton
                description={editDescription}
                onOptimized={setEditDescription}
                disabled={!editDescription.trim()}
                inline
              />
            </div>

            {/* 编辑模式附件上传 */}
            <input
              ref={editImageInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleEditImagePick}
            />
            <div
              tabIndex={0}
              role="button"
              aria-label="编辑模式文件上传区域"
              onClick={() => editImageInputRef.current?.click()}
              onDragOver={handleEditDragOver}
              onDragLeave={handleEditDragLeave}
              onDrop={handleEditDrop}
              onPaste={handleEditPaste}
              className={
                "cursor-pointer rounded-lg border border-dashed p-3 text-center transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30 " +
                (editDragActive
                  ? "border-primary bg-primary/5"
                  : "border-border/60 bg-muted/30 hover:bg-muted/50")
              }
            >
              <Paperclip className="mx-auto h-4 w-4 text-muted-foreground" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                点击、拖拽或粘贴添加文件
              </p>
            </div>

            {editPendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {editPendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="group relative h-8 w-8 overflow-hidden rounded border border-border/50 bg-muted"
                  >
                    {att.previewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={att.previewUrl}
                        alt={att.file.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center" title={att.file.name}>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeEditAttachment(att.id)}
                      className="absolute right-0 top-0 flex h-3 w-3 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="移除"
                    >
                      <X className="h-2 w-2" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {editImageError && (
              <p className="text-xs text-destructive">{editImageError}</p>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveEdit}
                disabled={updateMutation.isPending || editUploadingImages}
              >
                {updateMutation.isPending || editUploadingImages
                  ? "保存中…"
                  : "保存"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  editPendingAttachments.forEach((a) => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
                  setEditPendingAttachments([]);
                  setEditImageError(null);
                  setEditing(false);
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-3">
              <h2 className="flex-1 text-2xl font-semibold tracking-tight text-foreground">
                {item.title}
              </h2>
              <div className="flex shrink-0 items-center gap-1">
                {!isEnded && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    onClick={startEditing}
                    aria-label="编辑"
                    title="编辑"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {!isEnded && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    aria-label="删除"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            {item.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                <LarkAwareText text={item.description} />
              </p>
            )}

            {/* 图片附件紧靠描述下方 */}
            <WorkItemAttachmentsSection item={item} />
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/50 bg-muted/30 p-4">
          <MetaItem label="优先级">
            <Select
              aria-label="优先级"
              value={String(item.priority ?? 0)}
              onChange={(e) =>
                handleFieldUpdate({ priority: Number(e.target.value) })
              }
              disabled={fieldDisabled}
              options={PRIORITY_OPTIONS}
              className={inlineSelectClass}
            />
          </MetaItem>
          <MetaItem label="负责人">
            <Select
              aria-label="负责人"
              value={item.assignee ?? ""}
              onChange={(e) =>
                handleFieldUpdate({ assignee: e.target.value })
              }
              disabled={fieldDisabled}
              options={assigneeOptions}
              className={inlineSelectClass}
            />
          </MetaItem>
          <MetaItem label="版本">
            <Select
              aria-label="版本"
              value={item.version_id ?? ""}
              onChange={(e) =>
                handleFieldUpdate({ version_id: e.target.value })
              }
              disabled={fieldDisabled}
              options={versionOptions}
              className={inlineSelectClass}
            />
          </MetaItem>
          <MetaItem label="来源">
            <Badge variant="outline" className="text-[10px]">
              {item.source_type}
            </Badge>
          </MetaItem>
          <MetaItem label="创建时间">
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatTime(item.created_at)}
            </span>
          </MetaItem>
        </div>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              标签
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="rounded-md border-border/60 text-xs"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Approval action area */}
        <WorkItemApprovalSection item={item} />

        {/* Merge conflict section */}
        <WorkItemMergeConflictSection item={item} />

        {/* 跨仓库执行结果：仅项目组工作项且后端返回不为空时渲染 */}
        <CrossRepoResults
          workItemId={item.id}
          enabled={!!item.group_id}
        />

        {/* 产物 Artifacts */}
        <WorkItemArtifactsSection item={item} />

        {/* 流转历史（仅工作流模式且有数据） */}
        {item.flow_mode !== "freeform" && transitions && transitions.length > 0 && (
          <div>
          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            流转历史
          </div>
            <div className="space-y-2">
              {transitions.map((t: WorkItemTransition) => {
                // 流转记录中可能包含关联任务（agent 节点会触发 task），
                // 输出字段也可能内嵌 session_id；提取后渲染快捷链接。
                const sessionId = extractSessionId(t.output);
                return (
                  <div
                    key={t.id}
                    className="rounded-lg border border-border/50 bg-card p-3 shadow-card transition-smooth hover:shadow-card-hover"
                  >
                    <div className="flex items-center gap-3 text-xs">
                      <span
                        className="rounded-md bg-muted/60 px-2 py-0.5 text-muted-foreground"
                        title={t.from_node_id ?? "—"}
                      >
                        {t.from_node_id
                          ? nodeNameMap[t.from_node_id] || t.from_node_id
                          : "—"}
                      </span>
                      <span className="text-muted-foreground/60">→</span>
                      <span
                        className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary"
                        title={t.to_node_id}
                      >
                        {nodeNameMap[t.to_node_id] || t.to_node_id}
                      </span>
                      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                        {formatTime(t.created_at)}
                      </span>
                    </div>
                    {(t.task_id || sessionId) && (
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-3">
                        {t.task_id && !t.plan_tasks?.length && (
                          t.task_info ? (
                            <a
                              href={appPath(`/tasks/${t.task_info.id}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-smooth hover:bg-muted/50"
                            >
                              <span
                                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                                  TASK_STATUS_COLOR[t.task_info.status] ?? "bg-slate-400"
                                }`}
                              />
                              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                                {t.task_info.prompt?.slice(0, 60) || t.task_id.slice(0, 8)}
                              </span>
                              <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
                                {TASK_STATUS_LABEL[t.task_info.status] ?? t.task_info.status}
                              </span>
                            </a>
                          ) : (
                            <a
                              href={appPath(`/tasks/${t.task_id}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary text-xs hover:underline transition-smooth"
                            >
                              → 查看任务 {t.task_id.slice(0, 8)}
                            </a>
                          )
                        )}
                        {sessionId && (
                          <a
                            href={appPath(`/sessions/${sessionId}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary text-xs hover:underline transition-smooth"
                          >
                            → 查看会话 {sessionId.slice(0, 8)}
                          </a>
                        )}
                      </div>
                    )}
                    {/* Plan 子任务列表 */}
                    {t.plan_tasks && t.plan_tasks.length > 0 && (
                      <div className="mt-2 rounded-lg border border-border/50 bg-muted/20 p-2">
                        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Plan 任务 · {t.plan_tasks.length} 项
                        </div>
                        <div className="space-y-1">
                          {t.plan_tasks.map((pt: WorkItemPlanTask) => (
                            <a
                              key={pt.id}
                              href={appPath(`/tasks/${pt.id}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-smooth hover:bg-muted/50"
                            >
                              <span
                                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                                  TASK_STATUS_COLOR[pt.status] ?? "bg-slate-400"
                                }`}
                              />
                              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                                {pt.prompt?.slice(0, 60) || pt.id.slice(0, 8)}
                              </span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {TASK_STATUS_LABEL[pt.status] ?? pt.status}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {t.output && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-primary hover:text-primary/80">
                          查看输出
                        </summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/40 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">
                          {t.output}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 协作评论+共享上下文（所有模式） */}
        <WorkItemCollaborationSection item={item} currentUserId={user?.id} />
      </div>
    </PanelShell>
  );
}

interface WorkItemCollaborationSectionProps {
  item: WorkItem;
  currentUserId?: string;
}

/**
 * 协作区：评论线程（@mention 触发 Agent） + 共享上下文面板。
 * 评论是工作项的核心交互，所有模式通用。
 */
function WorkItemCollaborationSection({ item, currentUserId }: WorkItemCollaborationSectionProps) {
  const { data: contextEntries } = useWorkItemContext(item.id);
  const addContextMutation = useAddWorkItemContext();

  const handleAddContext = (contextType: string, content: string) => {
    addContextMutation.mutate({
      workItemId: item.id,
      contextType,
      content,
    });
  };

  return (
    <div className="space-y-6">
      <CommentThread
        workItemId={item.id}
        projectId={item.project_id}
        currentUserId={currentUserId}
      />
      <SharedContextPanel
        workItemId={item.id}
        contextEntries={contextEntries ?? item.context_stream ?? []}
        currentUserId={currentUserId}
        onAddContext={handleAddContext}
      />
    </div>
  );
}

interface WorkItemArtifactsSectionProps {
  item: WorkItem;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function isImageAttachment(att: WorkItemAttachment): boolean {
  if (att.type === "image") return true;
  return IMAGE_RE.test(att.name || att.path || "");
}

function getAttachmentContentUrl(itemId: string, att: WorkItemAttachment): string {
  return appPath(`/api/work-items/${encodeURIComponent(itemId)}/attachments/${encodeURIComponent(att.id)}/content`);
}

const isMarkdownAttachment = (name: string) => /\.(md|markdown)$/i.test(name);

function getAttachmentUrl(itemId: string, att: WorkItemAttachment): { url: string; isMarkdown: boolean } {
  const contentPath = `/api/work-items/${encodeURIComponent(itemId)}/attachments/${encodeURIComponent(att.id)}/content`;
  const name = att.name || att.path || "";
  if (isMarkdownAttachment(name)) {
    const title = encodeURIComponent(att.name || "文件");
    return { url: appPath(`/docs/view?url=${encodeURIComponent(contentPath)}&title=${title}`), isMarkdown: true };
  }
  return { url: appPath(contentPath), isMarkdown: false };
}

const LARK_DOC_RE = /https?:\/\/[^/]*\.(feishu\.cn|larkoffice\.com|larksuite\.com)\/(docx|wiki|sheets|base|slides)\/([a-zA-Z0-9]+)/;

/** Generic URL regex for splitting text into plain text + URL segments */
const URL_RE = /https?:\/\/[^\s<>"'\]\)]+/g;

/**
 * Renders text with Lark document URLs highlighted with special styling.
 * Non-Lark URLs are rendered as plain clickable links.
 * Plain text is rendered as-is.
 */
function LarkAwareText({ text }: { text: string }) {
  const segments: Array<{ type: "text" | "lark_url" | "url"; value: string }> = [];
  let lastIndex = 0;
  const urlRegex = new RegExp(URL_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const url = match[0];
    const { isLark } = detectLarkUrl(url);
    segments.push({ type: isLark ? "lark_url" : "url", value: url });
    lastIndex = urlRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  if (segments.length === 0) return <>{text}</>;

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <span key={i}>{seg.value}</span>;
        }
        if (seg.type === "lark_url") {
          return (
            <a
              key={i}
              href={seg.value}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              <LarkDocIcon />
              <span>{seg.value}</span>
              <span className="text-[10px] rounded bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5 text-blue-600 dark:text-blue-400 font-medium">
                飞书文档
              </span>
            </a>
          );
        }
        // Regular URL
        return (
          <a
            key={i}
            href={seg.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline transition-colors"
          >
            {seg.value}
          </a>
        );
      })}
    </>
  );
}

function detectLarkUrl(url: string): { isLark: boolean; docToken?: string } {
  const match = url.match(LARK_DOC_RE);
  if (match) return { isLark: true, docToken: match[3] };
  return { isLark: false };
}

function inferLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length > 0) return decodeURIComponent(parts[parts.length - 1]);
    return u.hostname;
  } catch {
    return url.slice(0, 40);
  }
}

function LarkDocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M14 4v6h6" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function WorkItemArtifactsSection({ item }: WorkItemArtifactsSectionProps) {
  const { user } = useAuth();
  const isViewer = user?.role === "viewer";
  const isTerminal = TERMINAL_STATUSES.has(item.status || "");
  const canEdit = !isViewer && !isTerminal;
  const addMutation = useAddArtifact();
  const removeMutation = useRemoveArtifact();
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkStage, setLinkStage] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const artifacts: WorkItemArtifact[] = (() => {
    const meta = item.metadata;
    if (!meta || typeof meta !== "object") return [];
    const list = (meta as Record<string, any>).artifacts;
    if (!Array.isArray(list)) return [];
    return list as WorkItemArtifact[];
  })();

  // 按 stage 分组
  const STAGE_LABELS: Record<string, string> = {
    test: "测试报告",
    doc: "文档",
    code: "代码",
    output: "输出",
  };
  const grouped = artifacts.reduce<Record<string, WorkItemArtifact[]>>(
    (acc, a) => {
      const key = a.stage || "";
      if (!acc[key]) acc[key] = [];
      acc[key].push(a);
      return acc;
    },
    {}
  );
  const groupedEntries = Object.entries(grouped);

  // Auto-detect Lark URL and set label
  const handleLinkUrlChange = (value: string) => {
    setLinkUrl(value);
    if (value.trim() && !linkLabel.trim()) {
      const { isLark } = detectLarkUrl(value.trim());
      if (isLark) {
        setLinkLabel("飞书文档");
      }
    }
  };

  const handleAddLink = async () => {
    const trimmedUrl = linkUrl.trim();
    const trimmedLabel = linkLabel.trim() || inferLabelFromUrl(trimmedUrl);
    if (!trimmedUrl) return;

    const { isLark } = detectLarkUrl(trimmedUrl);
    const type = isLark ? "lark_doc" : "link";

    await addMutation.mutateAsync({
      workItemId: item.id,
      data: {
        label: trimmedLabel,
        url: trimmedUrl,
        stage: linkStage.trim() || undefined,
        type,
      },
    });
    setLinkLabel("");
    setLinkUrl("");
    setLinkStage("");
    setShowLinkForm(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const res = await uploadWorkItemAttachments(item.id, Array.from(files));
      // Add each uploaded file as a "file" type artifact
      for (const att of res.attachments) {
        const contentPath = `/api/work-items/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(att.id)}/content`;
        const fileName = att.name || att.path || "文件";

        // markdown 文件使用 /docs/view 在线查看器
        const isMarkdown = /\.(md|markdown)$/i.test(fileName);
        const fileUrl = isMarkdown
          ? `/docs/view?url=${encodeURIComponent(contentPath)}&title=${encodeURIComponent(fileName)}`
          : contentPath;

        await addMutation.mutateAsync({
          workItemId: item.id,
          data: {
            label: fileName,
            url: fileUrl,
            type: "file",
          },
        });
      }
    } catch {
      // error handled by mutation
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmRemove = () => {
    if (!deleteTarget) return;
    removeMutation.mutate(
      { workItemId: item.id, artifactId: deleteTarget.id },
      { onSuccess: () => setDeleteTarget(null) }
    );
  };

  const getArtifactIcon = (artifact: WorkItemArtifact) => {
    if (artifact.type === "lark_doc") {
      return <LarkDocIcon />;
    }
    if (artifact.type === "file") {
      return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
    }
    return <span className="text-xs text-muted-foreground">•</span>;
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          产物
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLinkForm(!showLinkForm)}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-smooth"
            >
              <Link2 className="h-3 w-3" />
              {showLinkForm ? "取消" : "添加链接"}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-smooth disabled:opacity-50"
            >
              <Upload className="h-3 w-3" />
              {uploading ? "上传中…" : "上传文件"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        )}
      </div>

      {showLinkForm && (
        <div className="mb-3 space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
          <Input
            value={linkUrl}
            onChange={(e) => handleLinkUrlChange(e.target.value)}
            placeholder="链接地址 (支持飞书文档链接)"
            className="h-8 text-sm"
          />
          {linkUrl.trim() && detectLarkUrl(linkUrl.trim()).isLark && (
            <p className="text-[11px] text-green-600 flex items-center gap-1">
              <LarkDocIcon /> 已识别为飞书文档
            </p>
          )}
          <Input
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="显示名称（可选，自动推断）"
            className="h-8 text-sm"
          />
          <Input
            value={linkStage}
            onChange={(e) => setLinkStage(e.target.value)}
            placeholder="阶段名称（可选）"
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            onClick={handleAddLink}
            disabled={!linkUrl.trim() || addMutation.isPending}
          >
            {addMutation.isPending ? "添加中…" : "确认添加"}
          </Button>
        </div>
      )}

      {groupedEntries.length > 0 ? (
        <div className="space-y-3">
          {groupedEntries.map(([stageKey, items]) => (
            <div key={stageKey}>
              {stageKey && (
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                  {STAGE_LABELS[stageKey] || stageKey}
                </p>
              )}
              <div className="space-y-1">
                {items.map((artifact) => (
                  <div
                    key={artifact.id}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 transition-smooth hover:bg-muted/50"
                  >
                    {getArtifactIcon(artifact)}
                    <a
                      href={artifact.type === "lark_doc" ? artifact.url : appPath(artifact.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex-1 truncate text-sm hover:underline ${
                        artifact.type === "lark_doc"
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-primary"
                      }`}
                    >
                      {artifact.label}
                    </a>
                    {artifact.type === "lark_doc" && (
                      <span className="text-[10px] rounded bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5 text-blue-600 dark:text-blue-400">
                        飞书
                      </span>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setDeleteTarget({ id: artifact.id, label: artifact.label }); }}
                        className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                        title="删除产物"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-4 text-center text-xs text-muted-foreground">
          暂无产物
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除产物</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要删除产物「{deleteTarget?.label}」吗？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" size="sm" onClick={confirmRemove} disabled={removeMutation.isPending}>
              {removeMutation.isPending ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface WorkItemApprovalSectionProps {
  item: WorkItem;
}

interface WorkItemAttachmentsSectionProps {
  item: WorkItem;
}

function WorkItemAttachmentsSection({ item }: WorkItemAttachmentsSectionProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const { user } = useAuth();
  const isViewer = user?.role === "viewer";
  const isTerminal = TERMINAL_STATUSES.has(item.status || "");
  const canDelete = !isViewer && !isTerminal;
  const deleteMutation = useDeleteWorkItemAttachment();

  const attachments: WorkItemAttachment[] = (() => {
    const meta = item.metadata;
    if (!meta || typeof meta !== "object") return [];
    const list = (meta as Record<string, unknown>).attachments;
    if (!Array.isArray(list)) return [];
    return list as WorkItemAttachment[];
  })();

  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));

  const handleDelete = (attId: string, attName: string) => {
    if (!confirm(`确定删除附件「${attName}」？`)) return;
    deleteMutation.mutate({ workItemId: item.id, attachmentId: attId });
  };

  useEffect(() => {
    if (!lightboxUrl) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxUrl]);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        附件
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((att) => {
            const url = getAttachmentContentUrl(item.id, att);
            return (
              <div key={att.id} className="group relative h-12 w-12">
                <button
                  type="button"
                  onClick={() => setLightboxUrl(url)}
                  className="h-full w-full overflow-hidden rounded border border-border/50 bg-muted transition-smooth hover:border-primary/40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={att.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[8px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                    查看
                  </span>
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(att.id, att.name)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/90"
                    aria-label="删除"
                    title="删除附件"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((att) => {
            const { url, isMarkdown: isMd } = getAttachmentUrl(item.id, att);
            return (
              <div key={att.id} className="group relative inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs text-foreground transition-smooth hover:bg-muted/50">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...(!isMd ? { download: "" } : {})}
                  className="inline-flex items-center gap-1.5"
                >
                  <FileText className={`h-3.5 w-3.5 ${isMd ? "text-blue-500" : "text-muted-foreground"}`} />
                  <span className="max-w-[160px] truncate">{att.name}</span>
                  {isMd && (
                    <span className="text-[10px] rounded bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5 text-blue-600 dark:text-blue-400">
                      预览
                    </span>
                  )}
                </a>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(att.id, att.name)}
                    className="ml-1 flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                    aria-label="删除"
                    title="删除附件"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
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
    </div>
  );
}

function WorkItemApprovalSection({ item }: WorkItemApprovalSectionProps) {
  // 1. 拉取 workflow 以识别当前节点是否为审批节点（仅作为辅助判断、
  //    提供“节点名称”展示；workflow_id 为空时应跳过请求。
  const { data: workflow } = useWorkflow(item.workflow_id || "");
  const currentNode = workflow?.definition?.nodes?.find(
    (n) => n.id === item.current_node_id
  );

  // 2. 拉取 pending 审批列表，筛选出当前工作项的审批
  const { data: approvalsData } = useApprovals({ status: "pending" });
  const approval: Approval | undefined = (approvalsData?.items ?? []).find(
    (a) => {
      const detail = parseApprovalDetail(a);
      return (
        a.type === "work_item_transition" && detail.work_item_id === item.id
      );
    }
  );

  const approveMutation = useApproveApproval();
  const rejectMutation = useRejectApproval();
  const [comment, setComment] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  // 只要存在匹配的 pending 审批就展示入口。之前同时要求
  // “当前节点为 approval 类型”导致 workflow 定义节点 type 不一致时
  // 入口丢失。以是否存在实际的 pending approval 为唯一权威源。
  if (!approval) {
    return null;
  }

  const detail = parseApprovalDetail(approval);
  const reason = (detail.reason as string | undefined) || "";
  const isPending = approveMutation.isPending || rejectMutation.isPending;
  const isApprovalNode = currentNode?.type === "approval";

  const handleApprove = () => {
    setRejectError(null);
    approveMutation.mutate({
      id: approval.id,
      comment: comment.trim() || undefined,
    });
  };
  const handleReject = () => {
    if (!comment.trim()) {
      setRejectError("拒绝时请填写审批意见");
      return;
    }
    setRejectError(null);
    rejectMutation.mutate({
      id: approval.id,
      comment: comment.trim(),
    });
  };

  const error = approveMutation.error || rejectMutation.error;
  const nodeLabel =
    currentNode?.data?.label ||
    item.current_node_id ||
    (isApprovalNode ? "审批节点" : "待人工确认");

  return (
    <div>
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4 shadow-card">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
            <span className="flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            待审批
          </span>
          <Badge
            variant="outline"
            className="rounded-md border-amber-200 bg-background text-[10px] text-amber-800"
          >
            {nodeLabel}
          </Badge>
        </div>

        {reason && (
          <p className="mt-3 rounded-lg border-l-2 border-amber-400 bg-background/70 px-3 py-2 text-xs text-foreground/80">
            {reason}
          </p>
        )}

        {/* 审批意见输入 */}
        <div className="mt-3">
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-amber-800/80">
            审批意见<span className="ml-1 text-amber-700/70">（拒绝时必填）</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              if (rejectError) setRejectError(null);
            }}
            rows={2}
            placeholder="请输入审批意见…"
            className="w-full resize-none rounded-lg border border-amber-200/70 bg-background/80 px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            disabled={isPending}
          />
          {rejectError && (
            <p className="mt-1 text-[11px] text-destructive">{rejectError}</p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="flex-1 bg-emerald-600 text-white shadow-card transition-smooth hover:bg-emerald-700 hover:shadow-card-hover"
            onClick={handleApprove}
            disabled={isPending}
          >
            {approveMutation.isPending ? "审批中…" : "✓ 通过"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-destructive/30 text-destructive transition-smooth hover:bg-destructive/10 hover:text-destructive"
            onClick={handleReject}
            disabled={isPending}
          >
            {rejectMutation.isPending ? "拒绝中…" : "✕ 拒绝"}
          </Button>
        </div>

        {error && (
          <p className="mt-2 text-[11px] text-destructive">
            操作失败：{String(error)}
          </p>
        )}
      </div>
    </div>
  );
}

function WorkItemMergeConflictSection({ item }: { item: WorkItem }) {
  const [showPanel, setShowPanel] = useState(false);

  const meta = item.metadata as Record<string, any> | undefined;
  const mergeResult = meta?.git_merge_result as {
    success?: boolean;
    source_branch?: string;
    target_branch?: string;
    strategy?: string;
    conflict?: boolean;
    conflict_files?: string[];
    conflict_count?: number;
    on_conflict?: string;
    auto_push?: boolean;
    delete_source?: boolean;
    output?: string;
    timestamp?: string;
    repos?: Array<{
      project_name: string;
      merged_branches: Array<{
        branch: string;
        type?: string;
        success?: boolean;
      }>;
    }>;
  } | undefined;

  // 向后兼容：从旧结构读取冲突数据
  const hasOldConflict = meta?.merge_conflict === true;
  const conflictData = meta?.merge_conflict_data as {
    cwd?: string;
    source_branch?: string;
    target_branch?: string;
    conflict_files?: string[];
    project_name?: string;
    error_message?: string;
  } | undefined;

  // 无合并结果且无旧式冲突标记时不展示
  if (!mergeResult && !hasOldConflict) return null;

  // 合并成功展示
  if (mergeResult?.success) {
    const repos = mergeResult.repos || [];
    return (
      <div>
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-4 shadow-card">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-semibold text-emerald-800">合并成功</span>
            {mergeResult.target_branch && (
              <Badge variant="outline" className="text-[10px] font-mono ml-1">
                → {mergeResult.target_branch}
              </Badge>
            )}
          </div>

          {/* 多项目合并详情 */}
          {repos.length > 0 ? (
            <div className="mt-3 space-y-2">
              {repos.map((repo) => (
                <div key={repo.project_name} className="rounded-lg bg-white/60 border border-emerald-100 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-900">
                    <GitBranch className="h-3 w-3" />
                    <span>{repo.project_name}</span>
                  </div>
                  {repo.merged_branches.map((mb) => (
                    <div key={mb.branch} className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground pl-4">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {mb.branch}
                      </Badge>
                      <ArrowRight className="h-3 w-3" />
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {mergeResult.target_branch || "target"}
                      </Badge>
                      {mb.success && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            /* 单项目兼容 */
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[10px] font-mono">
                {mergeResult.source_branch || "source"}
              </Badge>
              <ArrowRight className="h-3 w-3" />
              <Badge variant="outline" className="text-[10px] font-mono">
                {mergeResult.target_branch || "target"}
              </Badge>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span>策略: {mergeResult.strategy || "merge"}</span>
            {mergeResult.auto_push && <span>• 已自动推送</span>}
            {mergeResult.delete_source && <span>• 已删除源分支</span>}
          </div>
          {mergeResult.timestamp && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{new Date(mergeResult.timestamp).toLocaleString("zh-CN")}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 冲突/失败展示
  const sourceBranch = mergeResult?.source_branch || conflictData?.source_branch || "source";
  const targetBranch = mergeResult?.target_branch || conflictData?.target_branch || "target";
  const conflictFiles = mergeResult?.conflict_files || conflictData?.conflict_files || [];
  const cwd = conflictData?.cwd || "";
  const projectName = conflictData?.project_name || "";
  const errorMessage = conflictData?.error_message || "";

  if (showPanel && conflictFiles.length > 0) {
    return (
      <div>
        <MergeConflictPanel
          projectId={item.project_id}
          workItemId={item.id}
          cwd={cwd}
          sourceBranch={sourceBranch}
          targetBranch={targetBranch}
          conflictFiles={conflictFiles}
          onResolved={() => setShowPanel(false)}
          onAbort={() => setShowPanel(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4 shadow-card">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <span className="text-xs font-semibold text-amber-800">合并冲突</span>
          {projectName && (
            <Badge variant="secondary" className="text-[10px]">
              {projectName}
            </Badge>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px] font-mono">
            {sourceBranch}
          </Badge>
          <ArrowRight className="h-3 w-3" />
          <Badge variant="outline" className="text-[10px] font-mono">
            {targetBranch}
          </Badge>
        </div>
        {errorMessage ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground whitespace-pre-line">
            {errorMessage}
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {conflictFiles.length > 0
              ? `${conflictFiles.length} 个文件存在冲突，需要手动解决`
              : "存在合并冲突，需要解决"}
          </p>
        )}
        {mergeResult?.timestamp && (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{new Date(mergeResult.timestamp).toLocaleString("zh-CN")}</span>
          </div>
        )}
        {conflictFiles.length > 0 && (
          <Button
            size="sm"
            className="mt-2 h-7 text-[11px] bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => setShowPanel(true)}
          >
            <GitMerge className="mr-1 h-3 w-3" />
            解决冲突
          </Button>
        )}
      </div>
    </div>
  );
}

function PanelShell({
  children,
  onClose,
  isExpanded,
  onToggleExpand,
  itemId,
}: {
  children: React.ReactNode;
  onClose: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  itemId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopyId = useCallback(() => {
    if (!itemId) return;
    navigator.clipboard.writeText(itemId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [itemId]);

  const [linkCopied, setLinkCopied] = useState(false);
  const handleCopyLink = useCallback(() => {
    if (!itemId) return;
    const url = `${window.location.origin}${appPath(`/work-items?detail=${itemId}`)}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }, [itemId]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className={`h-full w-full ${isExpanded ? "max-w-4xl" : "max-w-lg"} overflow-y-auto rounded-l-2xl border-l border-border/50 bg-card p-6 shadow-2xl animate-in slide-in-from-right-10`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between border-b border-border/40 pb-4">
          <span className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            工作项详情
          </span>
          <div className="flex items-center gap-1">
            {itemId && (
              <button
                onClick={handleCopyLink}
                title={linkCopied ? "链接已复制" : "复制链接"}
                aria-label="复制链接"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
              >
                {linkCopied ? <Check className="h-4 w-4 text-emerald-500" /> : <Link2 className="h-4 w-4" />}
              </button>
            )}
            {itemId && (
              <button
                onClick={handleCopyId}
                title={copied ? "已复制" : `点击复制 ID: ${itemId}`}
                className="mr-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
              >
                {copied ? "✓ 已复制" : itemId.slice(0, 8)}
              </button>
            )}
            <button
              onClick={onToggleExpand}
              title={isExpanded ? "还原" : "放大"}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function MetaItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
