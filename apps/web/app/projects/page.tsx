"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, Card, CardContent, Input } from "@tide/ui";
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
  useArchiveProject,
  useUnarchiveProject,
  useProjectGroups,
  type ProjectInfo,
  type CreateProjectInput,
} from "@tide/core";
import { ProjectGroupList, ProjectGroupCreateDialog } from "@tide/views";
import { useQueryClient } from "@tanstack/react-query";

type DialogMode = "new" | "clone";
type ViewTab = "projects" | "groups";

function formatTime(iso: string | null) {
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

interface ExtendedProject extends ProjectInfo {
  agents?: string[];
  session_count?: number;
  /** 列表接口不返回项目维度的 chat_count，仅详情接口提供。 */
  chat_count?: number | null;
  registered?: boolean;
  tags?: string[];
  archived?: boolean;
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      }
    >
      <ProjectsPageContent />
    </Suspense>
  );
}

function ProjectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<ViewTab>(() => {
    const v = searchParams.get("tab");
    return v === "groups" ? "groups" : "projects";
  });
  const { data, isLoading, isError } = useProjects({ show_archived: showArchived });
  const { data: groupsData } = useProjectGroups();
  const groupsTotal = groupsData?.groups?.length ?? 0;
  const createMutation = useCreateProject();
  const deleteMutation = useDeleteProject();
  const archiveMutation = useArchiveProject();
  const unarchiveMutation = useUnarchiveProject();

  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);
  const handledActionRef = useRef(false);

  // 首次进入时若 URL 携带 action=create 则自动打开新建项目弹窗
  useEffect(() => {
    if (handledActionRef.current) return;
    const action = searchParams.get("action");
    if (action === "create") {
      handledActionRef.current = true;
      setDialog("new");
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("action");
      const qs = sp.toString();
      router.replace(qs ? `/projects?${qs}` : "/projects", { scroll: false });
    }
  }, [searchParams, router]);

  const projects = (data?.projects ?? []) as ExtendedProject[];
  const total = projects.length;
  const registeredCount = useMemo(
    () => projects.filter((p) => p.registered).length,
    [projects]
  );
  const archivedCount = useMemo(
    () => projects.filter((p) => p.archived).length,
    [projects]
  );

  // 定时刷新：如果有项目处于 initializing 状态，每 5 秒自动刷新项目列表
  const hasInitializing = useMemo(
    () => projects.some((p) => p.init_status === "initializing"),
    [projects]
  );

  useEffect(() => {
    if (!hasInitializing) return;
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    }, 5000);
    return () => clearInterval(timer);
  }, [hasInitializing, queryClient]);

  return (
    <main className="mx-auto max-w-7xl px-2 py-2 space-y-8">
      {/* Header */}
      <header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">项目</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {tab === "projects"
                ? `关注的目录，按活跃排序 · 共 ${total} 个项目，${registeredCount} 个已注册${
                    showArchived && archivedCount > 0
                      ? ` · ${archivedCount} 已归档`
                      : ""
                  }`
                : "将多个仓库聚合为项目组，便于跨仓库工作项编排"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {tab === "projects" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowArchived((v) => !v)}
                >
                  {showArchived ? "隐藏归档" : "显示归档"}
                </Button>
                <Button variant="outline" onClick={() => setDialog("clone")}>
                  ＋ 添加已有
                </Button>
                <Button onClick={() => setDialog("new")}>＋ 新建项目</Button>
              </>
            ) : (
              <Button onClick={() => setGroupDialogOpen(true)}>＋ 新建项目组</Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-5 flex items-center gap-1 border-b border-border/60">
          <TabButton
            active={tab === "projects"}
            onClick={() => setTab("projects")}
          >
            所有项目
            <span className="ml-2 text-xs text-muted-foreground">{total}</span>
          </TabButton>
          <TabButton
            active={tab === "groups"}
            onClick={() => setTab("groups")}
          >
            项目组
            <span className="ml-2 text-xs text-muted-foreground">{groupsTotal}</span>
          </TabButton>
        </div>
      </header>

      {tab === "groups" ? (
        <ProjectGroupList
          projects={projects}
          onRequestCreate={() => setGroupDialogOpen(true)}
          onSelectGroup={(g) => router.push(`/projects/groups/${g.id}`)}
        />
      ) : isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-destructive">
          加载失败
        </div>
      ) : projects.length === 0 ? (
        <EmptyState onAdd={() => setDialog("clone")} onCreate={() => setDialog("new")} />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, idx) => (
            <ProjectCardItem
              key={project.id}
              project={project}
              index={idx}
              isRemoving={
                deleteMutation.isPending && pendingRemoveId === project.id
              }
              isArchiving={
                (archiveMutation.isPending || unarchiveMutation.isPending) &&
                pendingArchiveId === project.id
              }
              onRemove={async () => {
                if (!project.registered) return;
                if (!confirm(`从已知项目列表中移除 "${project.name}" ？\n（不会删除文件）`)) {
                  return;
                }
                setPendingRemoveId(project.id);
                try {
                  await deleteMutation.mutateAsync(project.id);
                } finally {
                  setPendingRemoveId(null);
                }
              }}
              onToggleArchive={async () => {
                setPendingArchiveId(project.id);
                try {
                  if (project.archived) {
                    await unarchiveMutation.mutateAsync(project.id);
                  } else {
                    await archiveMutation.mutateAsync(project.id);
                  }
                } finally {
                  setPendingArchiveId(null);
                }
              }}
            />
          ))}
        </div>
      )}

      {dialog && (
        <ProjectDialog
          mode={dialog}
          isPending={createMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await createMutation.mutateAsync(input);
            setDialog(null);
          }}
        />
      )}

      {groupDialogOpen && (
        <ProjectGroupCreateDialog
          projects={projects}
          onClose={() => setGroupDialogOpen(false)}
        />
      )}
    </main>
  );
}

function ProjectCardItem({
  project,
  index,
  isRemoving,
  isArchiving,
  onRemove,
  onToggleArchive,
}: {
  project: ExtendedProject;
  index: number;
  isRemoving: boolean;
  isArchiving: boolean;
  onRemove: () => void;
  onToggleArchive: () => void;
}) {
  const isInitializing = project.init_status === "initializing";
  const isError = project.init_status === "error";

  return (
    <Card
      className={
        isError
          ? "group relative bg-card rounded-xl shadow-card border-destructive/50 transition-smooth hover:shadow-card-hover"
          : isInitializing
          ? "group relative bg-card rounded-xl shadow-card opacity-75 transition-smooth hover:shadow-card-hover"
          : project.archived
          ? "group relative bg-card rounded-xl shadow-card opacity-70 transition-smooth hover:opacity-100 hover:shadow-card-hover"
          : "group relative bg-card rounded-xl shadow-card transition-smooth hover:shadow-card-hover"
      }
    >
      <CardContent className="p-0">
        <Link href={`/projects/${project.id}`} className="block p-5">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">
                №{String(index + 1).padStart(2, "0")} ·{" "}
                {project.registered ? "已注册" : "已发现"}
                {project.archived ? " · 已归档" : ""}
              </div>
              <h3 className="mt-1 truncate text-lg font-semibold tracking-tight">
                {project.name}
              </h3>
            </div>
            {isInitializing ? (
              <Badge variant="secondary" className="animate-pulse">
                初始化中
              </Badge>
            ) : isError ? (
              <Badge variant="destructive">错误</Badge>
            ) : project.archived ? (
              <Badge variant="secondary">已归档</Badge>
            ) : (
              <Badge variant={project.status === "active" ? "default" : "secondary"}>
                {project.status === "active" ? "活跃" : "空闲"}
              </Badge>
            )}
          </div>

          {/* 初始化中 - 显示进度指示 */}
          {isInitializing && (
            <div className="mb-4 flex items-center gap-2 rounded-md bg-muted px-3 py-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              <span className="text-xs text-muted-foreground">正在初始化...</span>
            </div>
          )}

          {/* 错误状态 - 显示错误信息 */}
          {isError && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <span className="text-xs text-destructive">
                {project.init_error || "初始化失败"}
              </span>
            </div>
          )}

          {/* 正常状态 - 显示路径 */}
          {!isInitializing && !isError && (
            <p className="mb-4 truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {project.cwd}
            </p>
          )}

          <div className="grid grid-cols-4 gap-2 border-t border-border/50 pt-3 text-center">
            <Stat label="TASKS" value={project.task_count} />
            <Stat label="SESSIONS" value={project.session_count ?? 0} />
            {/* CHATS 列表不精确计算（性能问题），仅项目详情页显示准确值；这里为空时占位为 "—"。 */}
            <Stat label="CHATS" value={project.chat_count ?? null} />
            <Stat label="AGENTS" value={(project.agents ?? []).length} />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-mono">{formatTime(project.last_active)}</span>
            <span className="flex flex-wrap gap-1">
              {(project.agents ?? []).slice(0, 4).map((a) => (
                <span
                  key={a}
                  className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                >
                  {a}
                </span>
              ))}
            </span>
          </div>

          {project.running_tasks > 0 && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {project.running_tasks} 个运行中
            </p>
          )}
        </Link>

        {project.registered && (
          <button
            type="button"
            disabled={isRemoving}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }}
            className="absolute right-2 top-2 rounded-md border border-border bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-smooth hover:border-destructive hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
          >
            {isRemoving ? "…" : "移除"}
          </button>
        )}

        <button
          type="button"
          disabled={isArchiving}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleArchive();
          }}
          className={
            "absolute right-2 " +
            (project.registered ? "top-9 " : "top-2 ") +
            "rounded-md border border-border bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-smooth hover:text-foreground group-hover:opacity-100 disabled:opacity-50"
          }
        >
          {isArchiving ? "…" : project.archived ? "取消归档" : "归档"}
        </button>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-lg font-semibold tracking-tight">
        {value === null || value === undefined ? "—" : value}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function EmptyState({
  onAdd,
  onCreate,
}: {
  onAdd: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center bg-card rounded-xl shadow-card py-20 text-center">
      <p className="text-sm text-muted-foreground">暂无项目</p>
      <p className="mt-2 text-base font-medium">
        关注一个目录，开始编排你的 Agent 工作
      </p>
      <div className="mt-6 flex gap-2">
        <Button variant="outline" onClick={onAdd}>＋ 添加已有</Button>
        <Button onClick={onCreate}>＋ 新建项目</Button>
      </div>
    </div>
  );
}

function ProjectDialog({
  mode,
  onClose,
  onSubmit,
  isPending,
}: {
  mode: DialogMode;
  onClose: () => void;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const title = mode === "new" ? "新建项目" : "添加已有项目";
  const subtitle =
    mode === "new"
      ? "创建一个新的空项目目录并注册到工作台"
      : "从 Git 仓库克隆代码并注册到工作台";

  const submit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写项目名称");
      return;
    }
    if (mode === "clone" && !repoUrl.trim()) {
      setError("请填写 Git 仓库 URL");
      return;
    }
    try {
      const input: CreateProjectInput = {
        name: trimmedName,
        mode,
        tags: tagsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (mode === "clone") {
        input.repo_url = repoUrl.trim();
        if (branch.trim()) {
          input.branch = branch.trim();
        }
      }
      await onSubmit(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl shadow-2xl border border-border/50 bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {mode === "new" ? "NEW · PROJECT" : "CLONE · PROJECT"}
          </span>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground transition-smooth"
          >
            ✕
          </button>
        </div>
        <div className="space-y-5 p-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <Field label="项目名称" required>
            <Input
              autoFocus
              placeholder="my-project"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
            />
          </Field>

          {mode === "clone" && (
            <>
              <Field label="Git 仓库 URL" required>
                <Input
                  placeholder="https://github.com/user/repo.git"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="rounded-lg border-border/50 focus:ring-2 focus:ring-ring font-mono text-sm"
                />
              </Field>

              <Field label="分支（可选）">
                <Input
                  placeholder="默认使用仓库默认分支"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="rounded-lg border-border/50 focus:ring-2 focus:ring-ring font-mono text-sm"
                />
              </Field>
            </>
          )}

          <Field label="标签（可选，逗号分隔）">
            <Input
              placeholder="frontend, infra, demo"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="rounded-lg border-border/50 focus:ring-2 focus:ring-ring font-mono text-sm"
            />
          </Field>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              ✕ {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border/50 pt-4">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button disabled={isPending} onClick={submit}>
              {isPending ? "保存中…" : mode === "new" ? "创建" : "克隆"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "relative px-4 py-2 text-sm font-medium transition-colors " +
        (active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
      {active && (
        <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" />
      )}
    </button>
  );
}
