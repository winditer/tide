"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  toast,
} from "@tide/ui";
import {
  useAgents,
  useDeleteKnowledgeFile,
  useKnowledgeFile,
  useKnowledgeFiles,
  useKnowledgeStatus,
  useSaveKnowledgeFile,
  useTriggerKnowledgeGenerate,
  downloadKnowledgeExport,
  type KnowledgeFileEntry,
  type KnowledgeGraphType,
  type KnowledgeJobStatus,
  type KnowledgeRepoFiles,
  type KnowledgeScope,
} from "@tide/core";
import { SimpleMarkdown } from "../shared/SimpleMarkdown";

export interface KnowledgeGraphCardProps {
  /** 范围：project（单个项目）或 group（项目组）。 */
  scope: KnowledgeScope;
  /** project_id 或 group_id。 */
  targetId: string;
}

const GRAPH_TYPE_OPTIONS: { value: KnowledgeGraphType; label: string }[] = [
  { value: "all", label: "全部图谱" },
  { value: "module", label: "模块依赖" },
  { value: "api", label: "API 接口" },
  { value: "db", label: "数据库 Schema" },
  { value: "concept", label: "业务概念" },
];

const STATUS_LABEL: Record<KnowledgeJobStatus, string> = {
  idle: "未生成",
  pending: "排队中",
  running: "生成中",
  completed: "已生成",
  failed: "失败",
};

const STATUS_VARIANT: Record<
  KnowledgeJobStatus,
  "default" | "secondary" | "destructive" | "outline" | "success"
> = {
  idle: "outline",
  pending: "secondary",
  running: "default",
  completed: "success",
  failed: "destructive",
};

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtTime(iso?: string | null): string {
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

function getApiErrorMessage(err: unknown): string {
  const e = err as { body?: unknown; message?: string };
  if (e?.body && typeof e.body === "object") {
    const detail = (e.body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return e?.message ?? String(err);
}

/** 把扁平文件列表按一级目录分组，方便树状渲染 */
function groupByTopDir(
  files: KnowledgeFileEntry[],
): { dir: string; items: KnowledgeFileEntry[] }[] {
  const map = new Map<string, KnowledgeFileEntry[]>();
  for (const f of files) {
    const idx = f.path.indexOf("/");
    const dir = idx >= 0 ? f.path.slice(0, idx) : "/";
    const arr = map.get(dir) ?? [];
    arr.push(f);
    map.set(dir, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "/") return -1;
      if (b === "/") return 1;
      return a.localeCompare(b);
    })
    .map(([dir, items]) => ({
      dir,
      items: items.sort((a, b) => a.path.localeCompare(b.path)),
    }));
}

/**
 * 知识图谱卡片：嵌入到项目 / 项目组的设置 Tab 中。
 *
 * 功能：
 * - 查看 `.knowledge/` 下所有 Markdown / JSON 文件；
 * - 选择文件后右侧显示内容（.md 可切换到编辑模式后保存）；
 * - 支持删除单个文件；
 * - "立即生成" 按异步任务执行后端脚本，自动轮询进度。
 */
export function KnowledgeGraphCard({ scope, targetId }: KnowledgeGraphCardProps) {
  const filesQuery = useKnowledgeFiles(scope, targetId);
  const statusQuery = useKnowledgeStatus(scope, targetId);
  const triggerMutation = useTriggerKnowledgeGenerate();
  const saveMutation = useSaveKnowledgeFile();
  const deleteMutation = useDeleteKnowledgeFile();
  const agentsQuery = useAgents();

  const repos: KnowledgeRepoFiles[] = filesQuery.data?.repos ?? [];

  // group 多仓库时需要选择当前查看的仓库
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!activeProjectId && repos.length > 0) {
      setActiveProjectId(repos[0].project_id);
    }
    if (
      activeProjectId &&
      repos.length > 0 &&
      !repos.some((r) => r.project_id === activeProjectId)
    ) {
      setActiveProjectId(repos[0].project_id);
    }
  }, [activeProjectId, repos]);

  const activeRepo: KnowledgeRepoFiles | undefined = useMemo(
    () =>
      repos.find((r) => r.project_id === activeProjectId) ?? repos[0],
    [repos, activeProjectId],
  );

  // 选中文件
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!activeRepo) {
      setSelectedPath(undefined);
      return;
    }
    const mdFile =
      activeRepo.files.find((f) => f.path === "_index.md") ??
      activeRepo.files.find((f) => f.ext === "md") ??
      activeRepo.files[0];
    setSelectedPath(mdFile?.path);
  }, [activeRepo?.project_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileQuery = useKnowledgeFile(
    scope,
    targetId,
    selectedPath,
    scope === "group" ? activeRepo?.project_id : undefined,
  );

  // 生成参数
  const [graphType, setGraphType] = useState<KnowledgeGraphType>("all");
  const [agentId, setAgentId] = useState<string>("");

  // Agent 选项列表
  const agentOptions = useMemo(() => {
    const agents = agentsQuery.data?.agents ?? [];
    return [
      { value: "", label: "静态分析（仅 Python）" },
      ...agents.map((a) => ({
        value: a.id,
        label: a.name + (a.type === "remote" ? " (远程)" : ""),
      })),
    ];
  }, [agentsQuery.data]);

  // 编辑模式
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setEditing(false);
    setDraft(fileQuery.data?.content ?? "");
  }, [fileQuery.data?.path, fileQuery.data?.content]);

  const [confirmDelete, setConfirmDelete] = useState(false);

  // 乐观状态：点击后立即禁用按钮，防止重复触发
  const [optimisticRunning, setOptimisticRunning] = useState(false);

  const jobStatus: KnowledgeJobStatus = statusQuery.data?.status ?? "idle";
  const isRunning = optimisticRunning || jobStatus === "pending" || jobStatus === "running";
  const progress = statusQuery.data?.progress;

  // 如果文件存在但任务状态为 idle（服务重启后），显示“已生成”
  const hasFiles = repos.some((r) => r.files.length > 0);
  const displayStatus: KnowledgeJobStatus =
    jobStatus === "idle" && hasFiles ? "completed" : jobStatus;

  const isMd = (selectedPath ?? "").toLowerCase().endsWith(".md");

  const handleTrigger = async () => {
    if (isRunning) return;
    setOptimisticRunning(true);
    try {
      await triggerMutation.mutateAsync({ scope, targetId, graphType, agentId: agentId || undefined });
      toast({ title: "已开始生成", description: "可在卡片顶部查看进度" });
      await statusQuery.refetch();
    } catch (err) {
      toast({
        title: "触发失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setOptimisticRunning(false);
    }
  };

  // 任务完成后刷新文件列表
  useEffect(() => {
    if (jobStatus === "completed") {
      filesQuery.refetch();
    }
  }, [jobStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!selectedPath || !isMd) return;
    try {
      await saveMutation.mutateAsync({
        scope,
        targetId,
        path: selectedPath,
        content: draft,
        projectId: scope === "group" ? activeRepo?.project_id : undefined,
      });
      toast({ title: "已保存" });
      setEditing(false);
    } catch (err) {
      toast({
        title: "保存失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedPath) return;
    try {
      await deleteMutation.mutateAsync({
        scope,
        targetId,
        path: selectedPath,
        projectId: scope === "group" ? activeRepo?.project_id : undefined,
      });
      toast({ title: "已删除" });
      setConfirmDelete(false);
      setSelectedPath(undefined);
    } catch (err) {
      toast({
        title: "删除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const totalFiles = repos.reduce((acc, r) => acc + r.files.length, 0);

  return (
    <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">
            知识图谱
            {activeRepo?.meta && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                v{activeRepo.meta.version ?? 1}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            仓库下 <code className="font-mono">.knowledge/</code>{" "}
            目录中的 Markdown / JSON 产物（模块依赖、API、数据库 Schema、业务概念）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[displayStatus]}>{STATUS_LABEL[displayStatus]}</Badge>
          {isRunning && progress && (
            <span className="font-mono text-xs text-muted-foreground">
              {progress.done}/{progress.total}
              {progress.current ? ` · ${progress.current}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* 生成控制 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-3">
        <span className="text-xs text-muted-foreground">生成类型：</span>
        <Select
          value={graphType}
          onChange={(e) => setGraphType(e.target.value as KnowledgeGraphType)}
          options={GRAPH_TYPE_OPTIONS}
          className="w-40"
          disabled={isRunning}
        />
        <span className="text-xs text-muted-foreground">分析方式：</span>
        <Select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          options={agentOptions}
          className="w-44"
          disabled={isRunning}
        />
        <Button
          onClick={handleTrigger}
          disabled={isRunning || triggerMutation.isPending}
        >
          {isRunning
            ? "生成中…"
            : triggerMutation.isPending
              ? "提交中…"
              : "立即生成"}
        </Button>
        {totalFiles > 0 && (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await downloadKnowledgeExport(
                  scope,
                  targetId,
                  scope === "group" ? activeRepo?.project_id : undefined,
                );
              } catch (err) {
                toast({
                  title: "导出失败",
                  description: err instanceof Error ? err.message : String(err),
                  variant: "destructive",
                });
              }
            }}
          >
            导出
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          最近：{fmtTime(statusQuery.data?.finished_at ?? statusQuery.data?.started_at)}
        </span>
      </div>

      {statusQuery.data?.status === "failed" && statusQuery.data.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          上次失败：{statusQuery.data.error}
        </div>
      )}

      {/* 多仓库切换（仅 group scope 且 >1 仓库） */}
      {scope === "group" && repos.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">仓库：</span>
          {repos.map((r) => (
            <button
              key={r.project_id}
              type="button"
              onClick={() => setActiveProjectId(r.project_id)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-smooth ${
                activeRepo?.project_id === r.project_id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
              }`}
            >
              {r.name}
              <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/70">
                {r.files.length}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 主体：左侧文件列表 + 右侧内容 */}
      {filesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : totalFiles === 0 ? (
        <p className="text-sm text-muted-foreground">
          暂无知识图谱产物。点击 “立即生成” 创建第一份图谱。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
          {/* 文件列表 */}
          <div className="max-h-[480px] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            {activeRepo?.files.length ? (
              groupByTopDir(activeRepo.files).map((group) => (
                <div key={group.dir} className="border-b border-zinc-100 last:border-b-0">
                  <div className="bg-zinc-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    {group.dir === "/" ? "root" : group.dir}
                  </div>
                  <ul>
                    {group.items.map((f) => {
                      const active = selectedPath === f.path;
                      return (
                        <li key={f.path}>
                          <button
                            type="button"
                            onClick={() => setSelectedPath(f.path)}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
                              active
                                ? "bg-blue-50 text-blue-700 border-l-2 border-blue-500"
                                : "hover:bg-zinc-50 text-zinc-600 border-l-2 border-transparent"
                            }`}
                          >
                            <span className="truncate font-mono text-[12px]">
                              {f.path.includes("/")
                                ? f.path.slice(f.path.indexOf("/") + 1)
                                : f.path}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                              {fmtBytes(f.size)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            ) : (
              <p className="p-3 text-sm text-zinc-400 italic">该仓库暂无产物</p>
            )}
          </div>

          {/* 文件内容 */}
          <div className="flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 bg-zinc-50/50">
              <div className="min-w-0 flex-1">
                {selectedPath ? (
                  <div className="truncate font-mono text-[12px] text-zinc-700">{selectedPath}</div>
                ) : (
                  <span className="text-sm text-zinc-400 italic">未选择文件</span>
                )}
                {fileQuery.data?.modified_at && (
                  <div className="mt-0.5 text-[10px] text-zinc-400">
                    更新于 {fmtTime(fileQuery.data.modified_at)} ·{" "}
                    {fmtBytes(fileQuery.data.size ?? 0)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isMd && selectedPath && !editing && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraft(fileQuery.data?.content ?? "");
                      setEditing(true);
                    }}
                  >
                    编辑
                  </Button>
                )}
                {editing && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditing(false);
                        setDraft(fileQuery.data?.content ?? "");
                      }}
                    >
                      取消
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={saveMutation.isPending}
                    >
                      {saveMutation.isPending ? "保存中…" : "保存"}
                    </Button>
                  </>
                )}
                {selectedPath && !editing && (
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    删除
                  </Button>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1 overflow-auto p-4 bg-white/60">
              {fileQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">加载中…</p>
              ) : fileQuery.isError ? (
                <p className="text-xs text-destructive">
                  读取失败：{getApiErrorMessage(fileQuery.error)}
                </p>
              ) : editing && isMd ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="h-[400px] w-full resize-y rounded-md border border-border/60 bg-background p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                />
              ) : fileQuery.data ? (
                isMd ? (
                  <div
                    className="max-w-full overflow-x-auto break-words"
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      const anchor = target.closest("a");
                      if (!anchor) return;
                      const href = anchor.getAttribute("href") || "";
                      // 仅拦截相对路径链接（非外部 URL）
                      if (href.includes("://") || href.startsWith("#")) return;
                      e.preventDefault();
                      // 解析相对路径：基于当前文件所在目录
                      const currentDir = selectedPath?.includes("/")
                        ? selectedPath.slice(0, selectedPath.lastIndexOf("/"))
                        : "";
                      const cleanHref = href.replace(/^\.\//,  "");
                      const parts = (currentDir ? `${currentDir}/${cleanHref}` : cleanHref).split("/");
                      // 规范化路径（处理 ../ 和 ./）
                      const resolved: string[] = [];
                      for (const p of parts) {
                        if (p === "" || p === ".") continue;
                        if (p === "..") { resolved.pop(); continue; }
                        resolved.push(p);
                      }
                      setSelectedPath(resolved.join("/"));
                    }}
                  >
                    <SimpleMarkdown
                      source={fileQuery.data.content}
                      variant="compact"
                      className="max-w-none"
                    />
                  </div>
                ) : (
                  <pre className="overflow-x-auto rounded-lg bg-zinc-800 p-3.5 font-mono text-[13px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words">
                    {fileQuery.data.content}
                  </pre>
                )
              ) : (
                <p className="text-sm text-zinc-400 italic">
                  从左侧列表选择一个文件
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除文件</DialogTitle>
            <DialogDescription>
              确定要删除 <code className="font-mono">{selectedPath}</code> 吗？
              此操作不可撤销（文件会从仓库 .knowledge/ 目录中移除）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleteMutation.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
