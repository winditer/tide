"use client";


import { useMemo, useState, useCallback } from "react";
import { Pencil, Trash2, AlertTriangle, GitMerge, Maximize2, Minimize2, CheckCircle2, ArrowRight, Clock } from "lucide-react";
import { Button, Badge, Input, Select } from "@tide/ui";
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
  useAuth,
  type WorkItem,
  type WorkItemUpdate,
  type WorkItemTransition,
  type WorkItemArtifact,
  type WorkItemPlanTask,
  type Approval,
} from "@tide/core";
import { CrossRepoResults } from "./CrossRepoResults";
import { MergeConflictPanel } from "../code-editor/MergeConflictPanel";

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

  const startEditing = () => {
    if (!item) return;
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!item) return;
    await updateMutation.mutateAsync({
      id: item.id,
      data: {
        title: editTitle.trim() || item.title,
        description: editDescription.trim() || undefined,
      },
    });
    setEditing(false);
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
  const fieldDisabled = updateMutation.isPending || isViewer;

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
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              className="w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="描述"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveEdit}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "保存中…" : "保存"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
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
              </div>
            </div>
            {item.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            )}
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

        {/* Transitions */}
        <div>
          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            流转历史
          </div>
          {transitions && transitions.length > 0 ? (
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
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {t.task_id && !t.plan_tasks?.length && (
                          <a
                            href={`/tasks/${t.task_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary text-xs hover:underline transition-smooth"
                          >
                            → 查看任务 {t.task_id.slice(0, 8)}
                          </a>
                        )}
                        {sessionId && (
                          <a
                            href={`/sessions/${sessionId}`}
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
                              href={`/tasks/${pt.id}`}
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
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
              暂无流转记录
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

interface WorkItemArtifactsSectionProps {
  item: WorkItem;
}

function WorkItemArtifactsSection({ item }: WorkItemArtifactsSectionProps) {
  const { user } = useAuth();
  const isViewer = user?.role === "viewer";
  const addMutation = useAddArtifact();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState("");

  const artifacts: WorkItemArtifact[] = (() => {
    const meta = item.metadata;
    if (!meta || typeof meta !== "object") return [];
    const list = (meta as Record<string, any>).artifacts;
    if (!Array.isArray(list)) return [];
    return list as WorkItemArtifact[];
  })();

  // 按 stage 分组
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

  const handleAdd = async () => {
    if (!label.trim() || !url.trim()) return;
    await addMutation.mutateAsync({
      workItemId: item.id,
      data: { label: label.trim(), url: url.trim(), stage: stage.trim() },
    });
    setLabel("");
    setUrl("");
    setStage("");
    setShowForm(false);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          产物
        </div>
        {!isViewer && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs font-medium text-primary hover:text-primary/80 transition-smooth"
          >
            {showForm ? "取消" : "+ 添加"}
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-3 space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="产物名称"
            className="h-8 text-sm"
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="链接地址 (https://...)"
            className="h-8 text-sm"
          />
          <Input
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            placeholder="阶段名称（可选）"
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!label.trim() || !url.trim() || addMutation.isPending}
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
                  {stageKey}
                </p>
              )}
              <div className="space-y-1">
                {items.map((artifact) => (
                  <div
                    key={artifact.id}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 transition-smooth hover:bg-muted/50"
                  >
                    <span className="text-xs text-muted-foreground">•</span>
                    <a
                      href={artifact.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 truncate text-sm text-primary hover:underline"
                    >
                      {artifact.label}
                    </a>
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
    </div>
  );
}

interface WorkItemApprovalSectionProps {
  item: WorkItem;
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
  } | undefined;

  // 向后兼容：从旧结构读取冲突数据
  const hasOldConflict = meta?.merge_conflict === true;
  const conflictData = meta?.merge_conflict_data as {
    cwd?: string;
    source_branch?: string;
    target_branch?: string;
    conflict_files?: string[];
  } | undefined;

  // 无合并结果且无旧式冲突标记时不展示
  if (!mergeResult && !hasOldConflict) return null;

  // 合并成功展示
  if (mergeResult?.success) {
    return (
      <div>
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-4 shadow-card">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-semibold text-emerald-800">合并成功</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-mono">
              {mergeResult.source_branch || "source"}
            </Badge>
            <ArrowRight className="h-3 w-3" />
            <Badge variant="outline" className="text-[10px] font-mono">
              {mergeResult.target_branch || "target"}
            </Badge>
          </div>
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
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {conflictFiles.length > 0
            ? `${conflictFiles.length} 个文件存在冲突，需要手动解决`
            : "存在合并冲突，需要解决"}
        </p>
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
