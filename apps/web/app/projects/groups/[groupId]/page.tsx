"use client";

/**
 * 项目组详情页（5 Tab 完整版）
 *
 * 路由：``/projects/groups/[groupId]``
 *
 * 页面承担五类职责（与项目详情页保持视觉一致）：
 * 1. Hero Header — 项目组名称 / 描述 / Meta strip / 编辑 / 删除入口；
 * 2. 对话 Tab    — 跨成员项目按 session_id 聚合的会话列表；
 * 3. 任务 Tab    — 跨成员项目聚合的任务列表（支持状态筛选）；
 * 4. 版本 Tab    — 跨成员项目聚合的版本列表（按所属项目分组展示）；
 * 5. 成员 Tab    — 成员项目卡片网格 + 添加 / 移除；
 * 6. 设置 Tab    — 工作流绑定 / 移除项目（危险操作）/ 删除项目组。
 */

import { use, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  FolderGit2,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Hash,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Tag,
  Trash2,
  Unlink,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  Workflow as WorkflowIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  toast,
} from "@tide/ui";
import {
  useAddGroupMember,
  useAddGroupUserMember,
  useAuth,
  useCleanupBranches,
  useCreateBranch,
  useCreateMergeRequest,
  useDeleteBranch,
  useDeleteGroupWorkflow,
  useDeleteProjectGroup,
  useFetchRemote,
  useGroupAvailableUsers,
  useGroupBranches,
  useGroupChanges,
  useGroupCommits,
  useGroupConversations,
  useGroupTasks,
  useGroupUserMembers,
  useGroupVersions,
  useGroupWorkflow,
  useMergeInteractive,
  useCommitMerge,
  useAbortMerge,
  useProjectGroup,
  useProjects,
  usePullBranch,
  usePushBranch,
  useRemoteBranches,
  useRemoveGroupMember,
  useRemoveGroupUserMember,
  useSetGroupWorkflow,
  useUpdateGroupUserMember,
  useUpdateProjectGroup,
  useWorkflows,
  type GroupBranchProject,
  type GroupChangeProject,
  type GroupConversationItem,
  type GroupTaskItem,
  type GroupUserMember,
  type GroupVersionItem,
  type ProjectGroupMember,
  type ProjectInfo,
  getGroupCommitDiff,
  appPath,
} from "@tide/core";
import { KnowledgeGraphCard, MergeConflictPanel } from "@tide/views";
import { FileTree } from "@tide/views/code-editor";

// ── Types & helpers ────────────────────────────────────────────────────────

type TabKey = "conversations" | "tasks" | "versions" | "files" | "branches" | "audit" | "members" | "knowledge" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "conversations", label: "对话" },
  { key: "tasks", label: "任务" },
  { key: "versions", label: "版本" },
  { key: "files", label: "文件" },
  { key: "audit", label: "审计" },
  { key: "branches", label: "分支" },
  { key: "members", label: "成员" },
  { key: "knowledge", label: "知识图谱" },
  { key: "settings", label: "设置" },
];

const ROLE_LABEL: Record<string, string> = {
  primary: "Primary",
  member: "Member",
};

const GROUP_USER_ROLE_OPTIONS = [
  { value: "owner", label: "所有者 (owner)" },
  { value: "member", label: "成员 (member)" },
  { value: "viewer", label: "只读 (viewer)" },
];

const GROUP_USER_ROLE_LABEL: Record<string, string> = {
  owner: "所有者",
  member: "成员",
  viewer: "只读",
};

const TASK_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "secondary",
  running: "default",
  review: "outline",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  approved: "secondary",
  rejected: "destructive",
};

const TASK_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  review: "待审批",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  approved: "已批准",
  rejected: "已拒绝",
};

const VERSION_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  released: "secondary",
  archived: "outline",
};

const VERSION_STATUS_LABEL: Record<string, string> = {
  active: "活跃",
  released: "已发布",
  archived: "已归档",
};

const TASK_STATUS_FILTER_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "queued", label: "排队中" },
  { value: "running", label: "运行中" },
  { value: "review", label: "待审批" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "stopped", label: "已停止" },
];

function formatTime(iso: string | null) {
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

function formatTimeShort(iso: string | null) {
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

function shortId(id: string | null | undefined, head = 8, tail = 4) {
  if (!id) return "—";
  return id.length > head + tail + 2
    ? `${id.slice(0, head)}…${id.slice(-tail)}`
    : id;
}

function getApiErrorMessage(err: unknown): string {
  const e = err as { body?: unknown; message?: string };
  if (e?.body && typeof e.body === "object") {
    const detail = (e.body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return e?.message ?? String(err);
}

// ── Page entry ─────────────────────────────────────────────────────────────

export default function ProjectGroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  return <GroupDetailContent groupId={groupId} />;
}

function GroupDetailContent({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { data, isLoading, isError, error } = useProjectGroup(groupId);
  const { data: projectsData } = useProjects({ show_archived: false });

  const [tab, setTab] = useState<TabKey>("conversations");
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = useDeleteProjectGroup();

  const members = useMemo(() => {
    const list = data?.members ?? [];
    return [...list].sort((a, b) => {
      if (a.role === "primary" && b.role !== "primary") return -1;
      if (b.role === "primary" && a.role !== "primary") return 1;
      return (a.display_order ?? 0) - (b.display_order ?? 0);
    });
  }, [data]);

  const memberIdSet = useMemo(
    () => new Set(members.map((m) => m.project_id)),
    [members],
  );

  const projectIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.project_id, m.name || m.project_id);
    return map;
  }, [members]);

  const cwdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.cwd) map.set(m.cwd, m.name || m.cwd);
    }
    return map;
  }, [members]);

  const primary = members.find((m) => m.role === "primary") ?? null;

  const handleDeleteGroup = async () => {
    try {
      await deleteMutation.mutateAsync(groupId);
      toast({ title: "已删除项目组", description: data?.name });
      router.replace("/projects?tab=groups");
    } catch (err) {
      toast({
        title: "删除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-12">
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-12">
        <Link
          href="/projects?tab=groups"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 返回项目组
        </Link>
        <div className="mt-12 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center text-sm text-destructive">
          加载失败
          {error instanceof Error ? `:${error.message}` : null}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-2 py-2">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/projects?tab=groups"
          className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 项目组
        </Link>
      </div>

      {/* Hero Header — 保留 Taylor 实现的渐变 / Meta 信息 */}
      <header className="relative overflow-hidden rounded-2xl border border-border/50 bg-card shadow-card">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-gradient-to-br from-primary/10 via-primary/0 to-transparent blur-2xl" />
        <div className="relative px-6 py-7 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                <FolderGit2 className="h-3.5 w-3.5" />
                <span>GROUP</span>
                <span className="opacity-50">·</span>
                <span className="font-mono">{data.workspace_id || "default"}</span>
              </div>
              <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight sm:text-4xl">
                {data.name}
              </h1>
              {data.description ? (
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {data.description}
                </p>
              ) : (
                <p className="mt-3 max-w-2xl text-sm italic text-muted-foreground/70">
                  未填写描述
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> 编辑
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> 删除
              </Button>
            </div>
          </div>

          {/* Meta strip */}
          <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border/40 pt-5 text-xs sm:grid-cols-4">
            <Meta
              label="成员项目"
              value={`${data.member_count ?? members.length}`}
            />
            <Meta
              label="用户成员"
              value={`${data.user_member_count ?? 0}`}
            />
            <Meta label="创建时间" value={formatTime(data.created_at)} mono />
            <Meta
              label="创建者"
              value={data.created_by?.trim() ? data.created_by : "—"}
            />
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-0 border-b border-border/50">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                "relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-smooth",
                active
                  ? "border-foreground text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "conversations" && (
        <ConversationsPane groupId={groupId} cwdToName={cwdToName} />
      )}

      {tab === "tasks" && (
        <TasksPane groupId={groupId} cwdToName={cwdToName} />
      )}

      {tab === "versions" && (
        <VersionsPane groupId={groupId} projectIdToName={projectIdToName} />
      )}

      {tab === "files" && (
        <FilesPane groupId={groupId} members={members} />
      )}

      {tab === "branches" && (
        <BranchesPane groupId={groupId} members={members} projectIdToName={projectIdToName} />
      )}

      {tab === "audit" && (
        <AuditPane groupId={groupId} projectIdToName={projectIdToName} />
      )}

      {tab === "members" && (
        <MembersPane
          groupId={groupId}
          members={members}
          onAdd={() => setAddOpen(true)}
        />
      )}

      {tab === "knowledge" && (
        <KnowledgeGraphCard scope="group" targetId={groupId} />
      )}

      {tab === "settings" && (
        <SettingsPane
          groupId={groupId}
          groupName={data.name}
          members={members}
          memberCount={data.member_count}
          isDeleting={deleteMutation.isPending}
          onDelete={handleDeleteGroup}
        />
      )}

      {/* Dialogs */}
      <EditGroupDialog
        open={editOpen}
        groupId={groupId}
        initialName={data.name}
        initialDescription={data.description ?? ""}
        onClose={() => setEditOpen(false)}
      />

      <AddMemberDialog
        open={addOpen}
        groupId={groupId}
        candidates={projectsData?.projects ?? []}
        excludeIds={memberIdSet}
        primaryExists={!!primary}
        onClose={() => setAddOpen(false)}
      />

      <DeleteGroupDialog
        open={deleteOpen}
        name={data.name}
        memberCount={data.member_count}
        isPending={deleteMutation.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteGroup}
      />
    </main>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "mt-1 truncate text-sm font-medium " +
          (mono ? "font-mono text-[13px]" : "")
        }
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

// ── Conversations Tab ──────────────────────────────────────────────────────

function ConversationsPane({
  groupId,
  cwdToName,
}: {
  groupId: string;
  cwdToName: Map<string, string>;
}) {
  const router = useRouter();
  const { data, isLoading, isError, error } = useGroupConversations(groupId, {
    limit: 100,
  });

  const items = data?.items ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">项目组会话</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            跨成员项目按 session_id 聚合的会话 · 共 {data?.total ?? 0} 个
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : isError ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-destructive">
          加载失败:{getApiErrorMessage(error)}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-muted-foreground">
          暂无对话记录
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden">
          <ul className="divide-y divide-border/50">
            {items.map((c) => (
              <ConversationRow
                key={c.session_id}
                item={c}
                projectName={c.cwd ? cwdToName.get(c.cwd) ?? null : null}
                onClick={() =>
                  router.push(`/sessions/${encodeURIComponent(c.session_id)}`)
                }
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ConversationRow({
  item,
  projectName,
  onClick,
}: {
  item: GroupConversationItem;
  projectName: string | null;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-4 p-4 text-left transition-smooth hover:bg-muted/50"
      >
        <div className="flex w-24 flex-col items-start gap-1">
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {item.agent_id || "agent"}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {shortId(item.session_id)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {item.session_id || "未命名会话"}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            {projectName && (
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                <FolderGit2 className="h-3 w-3" />
                {projectName}
              </span>
            )}
            <span className="font-mono">{item.task_count} 个任务</span>
          </div>
          {item.cwd && (
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
              ↳ {item.cwd}
            </p>
          )}
        </div>
        <div className="text-right text-[11px]">
          <div className="font-mono text-muted-foreground">
            {formatTimeShort(item.last_active)}
          </div>
          {item.last_status && (
            <div className="mt-1 font-mono uppercase tracking-wider text-muted-foreground">
              {item.last_status}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}

// ── Tasks Tab ──────────────────────────────────────────────────────────────

function TasksPane({
  groupId,
  cwdToName,
}: {
  groupId: string;
  cwdToName: Map<string, string>;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data, isLoading, isError, error } = useGroupTasks(groupId, {
    status: statusFilter || undefined,
    limit: 100,
  });

  const items = data?.items ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">项目组任务</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            跨成员项目聚合的执行指令 · 共 {data?.total ?? 0} 条
          </p>
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={TASK_STATUS_FILTER_OPTIONS}
          className="h-9 w-40 rounded-md border-border/50 text-xs"
        />
      </div>

      {isLoading ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : isError ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-destructive">
          加载失败:{getApiErrorMessage(error)}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-muted-foreground">
          暂无任务
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Prompt</th>
                <th className="px-4 py-3 font-medium">所属项目</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  projectName={t.cwd ? cwdToName.get(t.cwd) ?? null : null}
                  onClick={() => router.push(`/tasks/${t.id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TaskRow({
  task,
  projectName,
  onClick,
}: {
  task: GroupTaskItem;
  projectName: string | null;
  onClick: () => void;
}) {
  return (
    <tr
      className="cursor-pointer transition-smooth hover:bg-muted/50"
      onClick={onClick}
    >
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {shortId(task.id)}
      </td>
      <td className="max-w-[360px] truncate px-4 py-3">
        {task.prompt || "—"}
      </td>
      <td className="px-4 py-3">
        {projectName ? (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            <FolderGit2 className="h-3 w-3" />
            {projectName}
          </span>
        ) : (
          <span
            className="font-mono text-[11px] text-muted-foreground/70"
            title={task.cwd ?? undefined}
          >
            {task.cwd ? shortId(task.cwd, 18, 6) : "—"}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {task.agent_id || "—"}
      </td>
      <td className="px-4 py-3">
        <Badge variant={TASK_STATUS_VARIANT[task.status] ?? "outline"}>
          {TASK_STATUS_LABEL[task.status] ?? task.status}
        </Badge>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {formatTimeShort(task.created_at)}
      </td>
    </tr>
  );
}

// ── Files Tab ─────────────────────────────────────────────────────────────

function FilesPane({
  groupId,
  members,
}: {
  groupId: string;
  members: ProjectGroupMember[];
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    members.find((m) => m.role === "primary")?.project_id ?? members[0]?.project_id ?? ""
  );
  const selectedMember = members.find((m) => m.project_id === selectedProjectId);
  const router = useRouter();

  if (members.length === 0) {
    return (
      <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-muted-foreground">
        暂无成员项目
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">项目文件</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            浏览组内成员项目的文件
          </p>
        </div>
      </div>

      <div className="flex gap-4" style={{ minHeight: 480 }}>
        {/* 项目列表侧边栏 */}
        <div className="w-48 shrink-0 space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            成员项目
          </h3>
          {members.map((m) => (
            <button
              key={m.project_id}
              onClick={() => setSelectedProjectId(m.project_id)}
              className={[
                "w-full text-left px-3 py-2 rounded-lg text-sm transition-smooth",
                selectedProjectId === m.project_id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              ].join(" ")}
            >
              <FolderGit2 className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
              {m.name}
              {m.role === "primary" && (
                <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">
                  Primary
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* 文件树 */}
        <div className="flex-1 bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
          {selectedMember?.cwd ? (
            <FileTree
              projectId={selectedProjectId}
              rootPath={selectedMember.cwd}
              onFileSelect={() =>
                router.push(
                  `/projects/${encodeURIComponent(selectedProjectId)}/files`
                )
              }
              theme="light"
            />
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              项目路径不可用
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Branches Tab ──────────────────────────────────────────────────────────

function ProjectBranchCard({
  project,
  groupId,
  onMrRequest,
}: {
  project: GroupBranchProject;
  groupId: string;
  onMrRequest: (projectId: string, branch: string, branches: string[]) => void;
}) {
  const createBranch = useCreateBranch(project.project_id);
  const deleteBranch = useDeleteBranch(project.project_id);
  const cleanupBranches = useCleanupBranches(project.project_id);
  const fetchRemote = useFetchRemote(project.project_id);
  const pushBranch = usePushBranch(project.project_id);
  const pullBranch = usePullBranch(project.project_id);
  const { data: remoteBranchesData } = useRemoteBranches(project.project_id);
  const remoteBranchSet = new Set(remoteBranchesData?.branches ?? []);
  const mergeInteractive = useMergeInteractive(project.project_id);
  const commitMergeMutation = useCommitMerge(project.project_id);
  const abortMergeMutation = useAbortMerge(project.project_id);
  const qc = useQueryClient();

  // 合并本地和远端分支，去重，用于本地合并弹窗
  const remoteBranches = remoteBranchesData?.branches ?? [];
  const remoteOnlyBranches = remoteBranches.filter(b => !(project.branches || []).includes(b));
  const allMergeBranches = [...(project.branches || []), ...remoteOnlyBranches];

  const [expanded, setExpanded] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeStrategy, setMergeStrategy] = useState("merge");
  const [deleteSource, setDeleteSource] = useState(false);
  const [mergeConflictData, setMergeConflictData] = useState<{
    sourceBranch: string;
    targetBranch: string;
    conflicts: string[];
    cwd: string;
    deleteSource: boolean;
  } | null>(null);

  const handleExecuteMerge = async () => {
    try {
      const result = await mergeInteractive.mutateAsync({
        source_branch: mergeSource,
        target_branch: mergeTarget,
        strategy: mergeStrategy,
        delete_source: deleteSource,
      });

      if (result.ok) {
        toast({ title: "合并成功", description: result.output?.slice(0, 200) });
        setMergeDialogOpen(false);
        qc.invalidateQueries({ queryKey: ["project-group", groupId, "branches"] });
      } else if (result.conflicts?.length > 0) {
        // 进入冲突解决模式
        setMergeConflictData({
          sourceBranch: mergeSource,
          targetBranch: mergeTarget,
          conflicts: result.conflicts,
          cwd: result.cwd,
          deleteSource: deleteSource ?? false,
        });
        setMergeDialogOpen(false);
      } else {
        toast({ title: "合并失败", description: result.output?.slice(0, 200), variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "合并失败", description: err?.message || String(err), variant: "destructive" });
    }
  };

  const handleCreate = () => {
    if (!newBranchName.trim()) return;
    createBranch.mutateAsync({ branchName: newBranchName.trim() })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["project-group", groupId, "branches"] });
        setNewBranchName("");
        setShowCreateForm(false);
        toast({ title: "分支创建成功", description: newBranchName.trim() });
      })
      .catch((e) => toast({ title: "创建失败", description: getApiErrorMessage(e), variant: "destructive" }));
  };

  const handlePush = (branch: string) => {
    pushBranch.mutateAsync({ branchName: branch })
      .then(() => toast({ title: "Push 成功", description: branch }))
      .catch((e) => toast({ title: "Push 失败", description: getApiErrorMessage(e), variant: "destructive" }));
  };

  const handlePull = (branch: string) => {
    pullBranch.mutateAsync({ branchName: branch })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["project-group", groupId, "branches"] });
        toast({ title: "Pull 成功", description: branch });
      })
      .catch((e) => toast({ title: "Pull 失败", description: getApiErrorMessage(e), variant: "destructive" }));
  };

  const handleDelete = (branch: string) => {
    if (!confirm(`确定删除分支 "${branch}" 吗？此操作不可恢复。`)) return;
    deleteBranch.mutateAsync(branch)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["project-group", groupId, "branches"] });
        toast({ title: "分支已删除", description: branch });
      })
      .catch((e) => toast({ title: "删除失败", description: getApiErrorMessage(e), variant: "destructive" }));
  };

  return (
    <div className="bg-card rounded-xl shadow-card p-5 space-y-3 border border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
          {project.name}
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{project.branches.length}</Badge>
        </button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={fetchRemote.isPending}
            onClick={() => {
              fetchRemote.mutateAsync(undefined)
                .then(() => {
                  qc.invalidateQueries({ queryKey: ["project-group", groupId, "branches"] });
                  toast({ title: "Fetch 完成", description: `${project.name} 远端分支已同步` });
                })
                .catch((e) => toast({ title: "Fetch 失败", description: getApiErrorMessage(e), variant: "destructive" }));
            }}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${fetchRemote.isPending ? "animate-spin" : ""}`} />
            {fetchRemote.isPending ? "同步中" : "Fetch"}
          </Button>
          {project.branches.some((b) => b.startsWith("tide/")) && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              disabled={cleanupBranches.isPending}
              onClick={() => {
                if (!confirm(`确定清理 ${project.name} 中所有 tide/ 前缀的工作分支吗？`)) return;
                cleanupBranches.mutateAsync(undefined)
                  .then((data) => {
                    qc.invalidateQueries({ queryKey: ["project-group", groupId, "branches"] });
                    toast({ title: "清理完成", description: `已删除 ${(data as { cleaned: number }).cleaned} 个分支` });
                  })
                  .catch((e) => toast({ title: "清理失败", description: getApiErrorMessage(e), variant: "destructive" }));
              }}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {cleanupBranches.isPending ? "清理中…" : "清理"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            <Plus className="h-3 w-3 mr-1" />
            新建分支
          </Button>
        </div>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="flex items-center gap-2">
          <Input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="新分支名称"
            className="flex-1 rounded-lg border-border/50 font-mono text-xs"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleCreate} disabled={createBranch.isPending || !newBranchName.trim()}>
            {createBranch.isPending ? "创建中…" : "创建"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowCreateForm(false); setNewBranchName(""); }}>
            取消
          </Button>
        </div>
      )}

      {/* Branch List */}
      {expanded && (
        <div className="space-y-0.5">
          {project.branches.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">暂无分支</p>
          ) : (
            project.branches.map((branch) => (
              <div
                key={branch}
                className="group flex items-center justify-between rounded-lg px-3 py-1.5 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs truncate">{branch}</span>
                  {branch === project.current && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-0">当前</Badge>
                  )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Push" onClick={() => handlePush(branch)}>
                    <Upload className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Pull" onClick={() => handlePull(branch)}>
                    <Download className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="本地合并" onClick={() => { setMergeSource(branch); setMergeTarget(""); setMergeDialogOpen(true); }}>
                    <GitMerge className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    title={remoteBranchSet.has(branch) ? "Merge Request" : "分支未推送到远端，请先 Push"}
                    disabled={!remoteBranchSet.has(branch)}
                    onClick={() => onMrRequest(project.project_id, branch, remoteBranchesData?.branches ?? [])}
                  >
                    <GitPullRequest className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    title="删除分支"
                    disabled={branch === project.current}
                    onClick={() => handleDelete(branch)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Local Merge Dialog */}
      {mergeDialogOpen && (
        <Dialog open onOpenChange={(open) => { if (!open) setMergeDialogOpen(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>本地分支合并</DialogTitle>
              <DialogDescription>将源分支合并到目标分支（本地操作）</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">源分支</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={mergeSource}
                  onChange={(e) => setMergeSource(e.target.value)}
                >
                  <option value="">选择源分支</option>
                  {allMergeBranches.filter(b => b !== mergeTarget).map(b => (
                    <option key={b} value={b}>{b}{remoteOnlyBranches.includes(b) ? ' (remote)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">目标分支</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                >
                  <option value="">选择目标分支</option>
                  {allMergeBranches.filter(b => b !== mergeSource).map(b => (
                    <option key={b} value={b}>{b}{remoteOnlyBranches.includes(b) ? ' (remote)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">合并策略</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={mergeStrategy}
                  onChange={(e) => setMergeStrategy(e.target.value)}
                >
                  <option value="merge">Merge（保留提交历史）</option>
                  <option value="squash">Squash（压缩为单次提交）</option>
                  <option value="rebase">Rebase（变基）</option>
                </select>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={deleteSource}
                  onChange={(e) => setDeleteSource(e.target.checked)}
                  className="rounded border-input"
                />
                <span className="text-sm">合并后删除源分支</span>
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>取消</Button>
              <Button
                disabled={mergeInteractive.isPending || !mergeSource || !mergeTarget || mergeSource === mergeTarget}
                onClick={handleExecuteMerge}
              >
                {mergeInteractive.isPending ? "合并中…" : "执行合并"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 冲突解决面板（独立模式） */}
      {mergeConflictData && (
        <MergeConflictPanel
          projectId={project.project_id}
          cwd={mergeConflictData.cwd}
          sourceBranch={mergeConflictData.sourceBranch}
          targetBranch={mergeConflictData.targetBranch}
          conflictFiles={mergeConflictData.conflicts}
          onCommitMerge={async () => {
            await commitMergeMutation.mutateAsync({
              message: `Merge ${mergeConflictData.sourceBranch} into ${mergeConflictData.targetBranch} (conflicts resolved)`,
              delete_source: mergeConflictData.deleteSource ? mergeConflictData.sourceBranch : "",
            });
            qc.invalidateQueries({ queryKey: ["project-group", groupId, "branches"] });
          }}
          onAbortMerge={async () => {
            await abortMergeMutation.mutateAsync();
          }}
          onResolved={() => {
            toast({ title: "合并完成", description: "冲突已解决并提交" });
            setMergeConflictData(null);
          }}
          onAbort={() => {
            toast({ title: "合并已放弃" });
            setMergeConflictData(null);
          }}
        />
      )}
    </div>
  );
}

function BranchesPane({ groupId, members, projectIdToName }: {
  groupId: string;
  members: ProjectGroupMember[];
  projectIdToName: Map<string, string>;
}) {
  const { data, isLoading, isError, error } = useGroupBranches(groupId);
  const qc = useQueryClient();

  const [mrDialogState, setMrDialogState] = useState<{
    projectId: string;
    branch: string;
    branches: string[];
  } | null>(null);
  const [mrTitle, setMrTitle] = useState("");
  const [mrTargetBranch, setMrTargetBranch] = useState("");
  const [mrDescription, setMrDescription] = useState("");

  const createMR = useCreateMergeRequest(mrDialogState?.projectId);

  const openMrDialog = (projectId: string, branch: string, branches: string[]) => {
    setMrDialogState({ projectId, branch, branches });
    const otherBranches = branches.filter((b) => b !== branch);
    const defaultTarget = otherBranches.includes("main") ? "main" : otherBranches.includes("master") ? "master" : otherBranches[0] ?? "";
    setMrTargetBranch(defaultTarget);
    setMrTitle(`Merge ${branch} into ${defaultTarget}`);
    setMrDescription("");
  };

  const closeMrDialog = () => {
    setMrDialogState(null);
    setMrTitle("");
    setMrTargetBranch("");
    setMrDescription("");
  };

  const handleCreateMR = () => {
    if (!mrDialogState || !mrTargetBranch) return;
    createMR.mutateAsync({
      source_branch: mrDialogState.branch,
      target_branch: mrTargetBranch,
      title: mrTitle || `Merge ${mrDialogState.branch} into ${mrTargetBranch}`,
      description: mrDescription || undefined,
    })
      .then(() => {
        toast({ title: "MR 已创建", description: mrTitle });
        closeMrDialog();
      })
      .catch((e) => toast({ title: "MR 创建失败", description: getApiErrorMessage(e), variant: "destructive" }));
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">分支管理</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            组内成员项目的本地分支 · 共 {data?.items?.length ?? 0} 个项目
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : isError ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-destructive">
          加载失败:{getApiErrorMessage(error)}
        </div>
      ) : !data?.items?.length ? (
        <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-muted-foreground">
          暂无分支信息
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((project) => (
            <ProjectBranchCard
              key={project.project_id}
              project={project}
              groupId={groupId}
              onMrRequest={openMrDialog}
            />
          ))}
        </div>
      )}

      {/* MR Dialog */}
      {mrDialogState && (
        <Dialog open onOpenChange={(open) => { if (!open) closeMrDialog(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建 Merge Request</DialogTitle>
              <DialogDescription>从 {mrDialogState.branch} 合并到目标分支</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">源分支</span>
                <Input value={mrDialogState.branch} disabled className="font-mono text-xs" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">目标分支</span>
                <Select
                  value={mrTargetBranch}
                  onChange={(e) => {
                    setMrTargetBranch(e.target.value);
                    setMrTitle(`Merge ${mrDialogState.branch} into ${e.target.value}`);
                  }}
                  options={mrDialogState.branches.filter((b) => b !== mrDialogState.branch).map((b) => ({ value: b, label: b }))}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">标题</span>
                <Input
                  value={mrTitle}
                  onChange={(e) => setMrTitle(e.target.value)}
                  placeholder={`Merge ${mrDialogState.branch} into ${mrTargetBranch}`}
                  className="text-xs"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">描述（可选）</span>
                <textarea
                  value={mrDescription}
                  onChange={(e) => setMrDescription(e.target.value)}
                  placeholder="补充说明…"
                  className="w-full rounded-lg border border-border/50 bg-transparent px-3 py-2 text-xs min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeMrDialog}>取消</Button>
              <Button onClick={handleCreateMR} disabled={createMR.isPending || !mrTargetBranch}>
                {createMR.isPending ? "创建中…" : "创建 MR"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

// ── Audit Tab ─────────────────────────────────────────────────────────────

const TIME_RANGES = [
  { label: "今天", value: "today" },
  { label: "3天", value: "3d" },
  { label: "7天", value: "7d" },
  { label: "30天", value: "30d" },
  { label: "全部", value: "all" },
];

function AuditPane({ groupId, projectIdToName }: {
  groupId: string;
  projectIdToName: Map<string, string>;
}) {
  const [timeRange, setTimeRange] = useState("30d");
  const [selectedCommit, setSelectedCommit] = useState<{ projectId: string; hash: string; message: string } | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const since = useMemo(() => {
    if (timeRange === "all") return undefined;
    const now = new Date();
    const ms: Record<string, number> = { today: 1, "3d": 3, "7d": 7, "30d": 30 };
    const days = ms[timeRange] ?? 30;
    const d = new Date(now.getTime() - days * 86400000);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [timeRange]);

  const { data, isLoading, isError, error } = useGroupChanges(groupId, {
    group_by: "branch",
    since,
  });

  const { data: commitsData, isLoading: commitsLoading } = useGroupCommits(groupId, {
    since,
    limit: 50,
  });

  const projects = data?.projects ?? [];
  const commits = commitsData?.commits ?? [];

  const handleCommitClick = async (projectId: string, hash: string, message: string) => {
    setSelectedCommit({ projectId, hash, message });
    setDiffContent(null);
    setDiffError(null);
    setDiffLoading(true);
    try {
      const diff = await getGroupCommitDiff(groupId, projectId, hash);
      setDiffContent(diff || "(空 diff)");
    } catch (e: unknown) {
      setDiffError(getApiErrorMessage(e));
    } finally {
      setDiffLoading(false);
    }
  };

  const closeDiff = () => {
    setSelectedCommit(null);
    setDiffContent(null);
    setDiffError(null);
  };

  // ── Diff 查看面板 ──
  if (selectedCommit) {
    return (
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={closeDiff}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            返回
          </Button>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">Commit Diff</h2>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {selectedCommit.hash.slice(0, 8)} · {selectedCommit.message}
            </p>
          </div>
        </div>
        <div className="bg-card rounded-xl shadow-card border border-border/50 overflow-hidden">
          {diffLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">加载 diff 中…</div>
          ) : diffError ? (
            <div className="py-12 text-center text-sm text-destructive">加载失败：{diffError}</div>
          ) : (
            <pre className="p-4 text-xs font-mono overflow-auto max-h-[70vh] whitespace-pre-wrap break-all">
              {diffContent}
            </pre>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">代码审计</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            组内成员项目的代码变更统计
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => setTimeRange(tr.value)}
              className={[
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                timeRange === tr.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {tr.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : isError ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-destructive">
          加载失败:{getApiErrorMessage(error)}
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-muted-foreground">
          暂无代码变更记录
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((proj) => (
            <div key={proj.project_id} className="bg-card rounded-xl shadow-card border border-border/50 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-border/50 bg-muted/30">
                <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{proj.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {proj.changes.length} 个分支
                </Badge>
              </div>
              <div className="divide-y divide-border/50">
                {proj.changes.map((change, idx) => (
                  <div key={`${change.name}-${idx}`} className="flex items-center justify-between px-5 py-2.5 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="font-mono text-xs truncate">{change.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs shrink-0">
                      <span className="text-muted-foreground">{change.commit_count} 提交</span>
                      <span className="text-muted-foreground">{change.files_changed} 文件</span>
                      <span className="text-green-600 dark:text-green-400 font-mono">+{change.additions}</span>
                      <span className="text-red-600 dark:text-red-400 font-mono">-{change.deletions}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 提交历史（可点击查看 diff） ── */}
      <div className="pt-2">
        <h3 className="text-sm font-semibold mb-2">提交历史</h3>
        {commitsLoading ? (
          <div className="bg-card rounded-xl shadow-card py-8 text-center text-sm text-muted-foreground">
            加载提交记录中…
          </div>
        ) : commits.length === 0 ? (
          <div className="bg-card rounded-xl shadow-card py-8 text-center text-sm text-muted-foreground">
            暂无提交记录
          </div>
        ) : (
          <div className="bg-card rounded-xl shadow-card border border-border/50 overflow-hidden divide-y divide-border/50">
            {commits.map((c) => (
              <button
                key={`${c.project_id}-${c.hash}`}
                type="button"
                className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-muted/30 transition-colors text-left"
                onClick={() => handleCommitClick(c.project_id, c.hash, c.message)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Hash className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground">{c.hash.slice(0, 8)}</span>
                  <span className="text-xs truncate">{c.message}</span>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0 text-muted-foreground">
                  <span>{c.project_name}</span>
                  <span>{c.author}</span>
                  <span>{c.date ? new Date(c.date).toLocaleDateString() : ""}</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Versions Tab ───────────────────────────────────────────────────────────

function VersionsPane({
  groupId,
  projectIdToName,
}: {
  groupId: string;
  projectIdToName: Map<string, string>;
}) {
  const { data, isLoading, isError, error } = useGroupVersions(groupId, {
    limit: 200,
  });

  const items = data?.items ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">项目组版本</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            汇总组内全部成员项目的版本 · 共 {data?.total ?? 0} 个
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : isError ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-destructive">
          加载失败:{getApiErrorMessage(error)}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card py-16 text-center text-sm text-muted-foreground">
          暂无版本记录
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">版本</th>
                <th className="px-4 py-3 font-medium">描述</th>
                <th className="px-4 py-3 font-medium">所属项目</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  projectName={projectIdToName.get(v.project_id) ?? v.project_id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function VersionRow({
  version,
  projectName,
}: {
  version: GroupVersionItem;
  projectName: string;
}) {
  return (
    <tr className="hover:bg-muted/40 transition-smooth">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{version.name}</span>
        </div>
      </td>
      <td className="max-w-[360px] truncate px-4 py-3 text-muted-foreground">
        {version.description || "—"}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/projects/${encodeURIComponent(version.project_id)}`}
          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <FolderGit2 className="h-3 w-3" />
          {projectName}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Badge variant={VERSION_STATUS_VARIANT[version.status] ?? "outline"}>
          {VERSION_STATUS_LABEL[version.status] ?? version.status}
        </Badge>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {formatTimeShort(version.created_at)}
      </td>
    </tr>
  );
}

// ── Members Tab ────────────────────────────────────────────────────────────

function MembersPane({
  groupId,
  members,
  onAdd,
}: {
  groupId: string;
  members: ProjectGroupMember[];
  onAdd: () => void;
}) {
  return (
    <div className="space-y-10">
      <UserMembersSection groupId={groupId} />
      <ProjectMembersSection
        groupId={groupId}
        members={members}
        onAdd={onAdd}
      />
    </div>
  );
}

function UserMembersSection({ groupId }: { groupId: string }) {
  const { user } = useAuth();
  const isGlobalAdmin = user?.role === "admin";

  const membersQuery = useGroupUserMembers(groupId);
  const updateMutation = useUpdateGroupUserMember(groupId);
  const removeMutation = useRemoveGroupUserMember(groupId);

  const [addOpen, setAddOpen] = useState(false);

  const members = membersQuery.data?.members ?? [];
  const memberIds = useMemo(
    () => new Set(members.map((m) => m.id)),
    [members],
  );

  const myGroupRole = useMemo(() => {
    if (!user) return null;
    return members.find((m) => m.id === user.id)?.group_role ?? null;
  }, [members, user]);
  const canManage = isGlobalAdmin || myGroupRole === "owner";

  const handleRoleChange = async (member: GroupUserMember, role: string) => {
    if (role === member.group_role) return;
    try {
      await updateMutation.mutateAsync({
        userId: member.id,
        body: { role },
      });
      toast({
        title: "已更新角色",
        description: `${member.username} → ${
          GROUP_USER_ROLE_LABEL[role] ?? role
        }`,
      });
    } catch (err) {
      toast({
        title: "更新失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const handleRemove = async (member: GroupUserMember) => {
    if (!confirm(`将 ${member.username} 从该项目组移除？`)) return;
    try {
      await removeMutation.mutateAsync(member.id);
      toast({ title: "已移除成员", description: member.username });
    } catch (err) {
      toast({
        title: "移除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Users className="h-4 w-4 text-muted-foreground" />
            用户成员
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            管理可访问该项目组的用户与各自的角色 · 共 {members.length} 人
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} className="gap-1.5">
            <UserPlus className="h-4 w-4" /> 添加成员
          </Button>
        )}
      </div>

      {membersQuery.isLoading ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : membersQuery.isError ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-destructive">
          加载失败：{getApiErrorMessage(membersQuery.error)}
        </div>
      ) : members.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card border border-border/50 py-16 text-center">
          <ShieldCheck
            className="mx-auto h-8 w-8 text-muted-foreground/60"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm text-muted-foreground">
            该项目组暂无用户成员
          </p>
          {canManage && (
            <Button
              className="mt-5 gap-1.5"
              onClick={() => setAddOpen(true)}
            >
              <UserPlus className="h-4 w-4" /> 添加第一位成员
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">项目组角色</th>
                <th className="px-4 py-3 font-medium">加入时间</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {members.map((m) => {
                const isSelf = user?.id === m.id;
                return (
                  <tr
                    key={m.id}
                    className="hover:bg-muted/40 transition-smooth"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 text-[11px] font-semibold uppercase text-indigo-500">
                          {(m.username || "?").slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{m.username}</span>
                            {isSelf && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                ME
                              </span>
                            )}
                            {m.global_role === "admin" && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-500">
                                <ShieldCheck className="h-2.5 w-2.5" /> Admin
                              </span>
                            )}
                          </div>
                          {m.display_name && (
                            <div className="truncate text-xs text-muted-foreground">
                              {m.display_name}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {m.email || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <Select
                          value={m.group_role}
                          onChange={(e) =>
                            handleRoleChange(m, e.target.value)
                          }
                          options={GROUP_USER_ROLE_OPTIONS}
                          disabled={updateMutation.isPending}
                          className="h-8 w-36 rounded-md border-border/50 text-xs"
                        />
                      ) : (
                        <Badge variant="secondary">
                          {GROUP_USER_ROLE_LABEL[m.group_role] ?? m.group_role}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {m.joined_at
                        ? new Date(m.joined_at).toLocaleDateString("zh-CN")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleRemove(m)}
                            title="移除成员"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddUserMemberDialog
        groupId={groupId}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        excludeIds={memberIds}
      />
    </section>
  );
}

function AddUserMemberDialog({
  groupId,
  open,
  onClose,
  excludeIds,
}: {
  groupId: string;
  open: boolean;
  onClose: () => void;
  excludeIds: Set<string>;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);

  const addMutation = useAddGroupUserMember(groupId);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setDebounced("");
      setSelectedUserIds(new Set());
      setRole("member");
      setError(null);
    }
  }, [open]);

  const usersQuery = useGroupAvailableUsers(groupId, {
    q: debounced || undefined,
    page: 1,
    page_size: 20,
  });

  const candidates = useMemo(() => {
    const list = usersQuery.data?.items ?? [];
    return list.filter((u) => !excludeIds.has(u.id));
  }, [usersQuery.data, excludeIds]);

  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setError(null);
    if (selectedUserIds.size === 0) {
      setError("请至少选择一名用户");
      return;
    }
    try {
      await Promise.all(
        Array.from(selectedUserIds).map((user_id) =>
          addMutation.mutateAsync({ user_id, role }),
        ),
      );
      toast({
        title: "已添加成员",
        description: `成功添加 ${selectedUserIds.size} 名用户`,
      });
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  const adminApiBlocked = usersQuery.isError;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> 添加项目组用户成员
          </DialogTitle>
          <DialogDescription>
            选择一个已有用户加入到当前项目组，并指定项目组内的角色。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              搜索用户
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="按用户名 / 邮箱 / 显示名称搜索…"
                className="pl-9 rounded-lg border-border/50"
              />
            </div>
          </label>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-border/50 bg-background/60">
            {adminApiBlocked ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                无法列出全部用户（需要管理员权限）。
                <br />
                你仍可以输入用户 ID 手动添加。
              </div>
            ) : usersQuery.isLoading ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                加载中…
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                {debounced ? "没有匹配的用户" : "暂无可添加的用户"}
              </div>
            ) : (
              <ul className="divide-y divide-border/50">
                {candidates.map((u) => {
                  const active = selectedUserIds.has(u.id);
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => toggleUser(u.id)}
                        className={[
                          "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-smooth",
                          active
                            ? "bg-indigo-500/10 text-foreground"
                            : "hover:bg-muted/60",
                        ].join(" ")}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] " +
                              (active
                                ? "border-indigo-500 bg-indigo-500 text-white"
                                : "border-border bg-background text-muted-foreground")
                            }
                          >
                            {active ? "✓" : ""}
                          </span>
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 text-[11px] font-semibold uppercase text-indigo-500">
                            {(u.username || "?").slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {u.username}
                              {u.display_name && (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  · {u.display_name}
                                </span>
                              )}
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              {u.email || "—"}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant={u.role === "admin" ? "default" : "outline"}
                          className="shrink-0"
                        >
                          {u.role}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {adminApiBlocked && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                用户 ID（手动）
              </span>
              <Input
                value={
                  selectedUserIds.size === 1
                    ? Array.from(selectedUserIds)[0]
                    : ""
                }
                onChange={(e) =>
                  setSelectedUserIds(
                    e.target.value ? new Set([e.target.value]) : new Set(),
                  )
                }
                placeholder="粘贴目标用户的 UUID"
                className="rounded-lg border-border/50 font-mono text-xs"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              项目组角色
            </span>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={GROUP_USER_ROLE_OPTIONS}
              className="rounded-lg border-border/50"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            已选 {selectedUserIds.size} 名用户
          </div>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={selectedUserIds.size === 0 || addMutation.isPending}
            onClick={submit}
          >
            {addMutation.isPending ? "添加中…" : "添加选中用户"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectMembersSection({
  groupId,
  members,
  onAdd,
}: {
  groupId: string;
  members: ProjectGroupMember[];
  onAdd: () => void;
}) {
  const removeMutation = useRemoveGroupMember(groupId);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const handleRemove = async (member: ProjectGroupMember) => {
    if (
      !confirm(
        `确认从项目组中移除 "${member.name}" ？\n（不会删除该项目本身）`,
      )
    ) {
      return;
    }
    setPendingRemoveId(member.project_id);
    try {
      await removeMutation.mutateAsync(member.project_id);
      toast({ title: "已移除成员", description: member.name });
    } catch (err) {
      toast({
        title: "移除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPendingRemoveId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <FolderGit2 className="h-4 w-4 text-muted-foreground" />
            成员项目
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            组内首个项目（primary）作为跨仓库工作项的执行根目录
          </p>
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> 添加成员项目
        </Button>
      </div>

      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">尚未加入任何项目</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            将已注册的项目加入到此组，即可联合编排
          </p>
          <Button size="sm" className="mt-5" onClick={onAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" /> 添加首个成员项目
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m, idx) => (
            <MemberCard
              key={m.id}
              member={m}
              index={idx}
              isRemoving={
                removeMutation.isPending && pendingRemoveId === m.project_id
              }
              onRemove={() => handleRemove(m)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MemberCard({
  member,
  index,
  isRemoving,
  onRemove,
}: {
  member: ProjectGroupMember;
  index: number;
  isRemoving: boolean;
  onRemove: () => void;
}) {
  const isPrimary = member.role === "primary";
  const missing = !member.cwd;
  const projectHref = `/projects/${encodeURIComponent(member.project_id)}`;

  return (
    <Card
      className={
        "group relative rounded-xl bg-card shadow-card transition-smooth hover:shadow-card-hover " +
        (isPrimary ? "border-primary/40" : "")
      }
    >
      <CardContent className="p-0">
        <Link href={projectHref} className="block p-5">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                <span>№{String(index + 1).padStart(2, "0")}</span>
                <span className="opacity-50">·</span>
                <span>{ROLE_LABEL[member.role] ?? member.role}</span>
              </div>
              <h3 className="mt-1 truncate text-base font-semibold tracking-tight">
                {member.name}
              </h3>
            </div>
            {isPrimary ? (
              <Badge className="gap-1">
                <Star className="h-3 w-3" /> Primary
              </Badge>
            ) : (
              <Badge variant="secondary">Member</Badge>
            )}
          </div>

          {missing ? (
            <p className="mb-2 truncate rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 font-mono text-[11px] text-destructive">
              路径已不存在
            </p>
          ) : (
            <p
              className="mb-2 truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
              title={member.cwd ?? undefined}
            >
              {member.cwd}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
            <span className="font-mono">order · {member.display_order}</span>
            <span className="font-mono">{formatTime(member.added_at)}</span>
          </div>
        </Link>

        <button
          type="button"
          disabled={isRemoving}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-smooth hover:border-destructive hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
        >
          <UserMinus className="h-3 w-3" />
          {isRemoving ? "…" : "移除"}
        </button>
      </CardContent>
    </Card>
  );
}

// ── Settings Tab ───────────────────────────────────────────────────────────

function SettingsPane({
  groupId,
  groupName,
  members,
  memberCount,
  isDeleting,
  onDelete,
}: {
  groupId: string;
  groupName: string;
  members: ProjectGroupMember[];
  memberCount: number;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  return (
    <section className="space-y-6">
      {/* Basic info */}
      <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            项目组名称
          </div>
          <div className="mt-1 text-base font-medium">{groupName}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            项目组 ID
          </div>
          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {groupId}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            成员数量
          </div>
          <div className="mt-1 text-sm">{memberCount} 个成员项目</div>
        </div>
      </div>

      {/* Workflow Binding */}
      <WorkflowBindingCard groupId={groupId} members={members} />

      {/* Member project removal */}
      <MemberRemovalCard groupId={groupId} members={members} />

      {/* Danger zone — delete group */}
      <div className="bg-card rounded-xl shadow-card border border-destructive/30 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-destructive">
              危险区
            </div>
            <p className="mt-1 text-sm">
              删除项目组将解除组内所有项目的关联，但
              <strong>不会删除项目本身</strong>。
            </p>
          </div>
          <Button
            variant="destructive"
            disabled={isDeleting}
            onClick={() => {
              if (confirm(`确认删除项目组 "${groupName}"？此操作不可撤销。`)) {
                onDelete();
              }
            }}
          >
            {isDeleting ? "删除中…" : "删除项目组"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function WorkflowBindingCard({ groupId, members = [] }: { groupId: string; members?: ProjectGroupMember[] }) {
  const [selectedWfId, setSelectedWfId] = useState("");
  const [flowMode, setFlowMode] = useState<
    "default_workflow" | "custom_workflow" | "freeform"
  >("default_workflow");
  const workflowsQuery = useWorkflows();
  const bindingQuery = useGroupWorkflow(groupId);
  const setMutation = useSetGroupWorkflow();
  const deleteMutation = useDeleteGroupWorkflow();

  const workflows = workflowsQuery.data ?? [];
  const enabledWorkflows = workflows.filter((w) => w.enabled);
  const binding = bindingQuery.data;

  // 从后端设置同步流转模式（仅在数据加载后初始化一次）
  useEffect(() => {
    if (binding?.flow_mode) {
      setFlowMode(binding.flow_mode as typeof flowMode);
    }
  }, [binding?.flow_mode]);

  const currentWorkflowName = binding?.workflow_id
    ? binding.workflow_name ??
      workflows.find((w) => w.id === binding.workflow_id)?.name ??
      binding.workflow_id
    : undefined;

  const workflowOptions = [
    { value: "", label: "-- 选择工作流 --" },
    ...enabledWorkflows.map((wf) => ({ value: wf.id, label: wf.name })),
  ];

  const isFreeform = flowMode === "freeform";

  const FLOW_MODE_OPTIONS: {
    value: typeof flowMode;
    label: string;
    desc: string;
  }[] = [
    {
      value: "default_workflow",
      label: "默认工作流",
      desc: "使用系统内建 4 阶段流程",
    },
    {
      value: "custom_workflow",
      label: "自定义工作流",
      desc: "绑定自定义工作流",
    },
    {
      value: "freeform",
      label: "自由协作",
      desc: "无工作流，直接分配",
    },
  ];

  const handleSelectFlowMode = async (
    mode: "default_workflow" | "custom_workflow" | "freeform"
  ) => {
    if (mode === flowMode) return;
    setFlowMode(mode);
    try {
      if (mode === "freeform") {
        // freeform 无需工作流，立即持久化模式
        await setMutation.mutateAsync({ groupId, flowMode: mode });
      } else if (binding?.workflow_id) {
        // 已绑定工作流时，切回工作流模式立即持久化
        await setMutation.mutateAsync({
          groupId,
          workflowId: binding.workflow_id,
          flowMode: mode,
        });
      } else {
        // 尚未绑定工作流，仅持久化模式
        await setMutation.mutateAsync({ groupId, flowMode: mode });
      }
    } catch (err) {
      toast({
        title: "切换模式失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const handleBind = async () => {
    if (!selectedWfId) return;
    try {
      await setMutation.mutateAsync({ groupId, workflowId: selectedWfId, flowMode });
      const wf = workflows.find((w) => w.id === selectedWfId);
      toast({ title: "已绑定工作流", description: wf?.name ?? selectedWfId });
      setSelectedWfId("");
    } catch (err) {
      toast({
        title: "绑定失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const handleUnbind = async () => {
    try {
      await deleteMutation.mutateAsync(groupId);
      toast({ title: "已解绑工作流" });
    } catch (err) {
      toast({
        title: "解绑失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      {/* Flow Mode Selector */}
      <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <div>
          <h2 className="text-base font-medium">工作流模式</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            选择项目组下工作项的默认流转方式。
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FLOW_MODE_OPTIONS.map((opt) => {
            const active = flowMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelectFlowMode(opt.value)}
                disabled={setMutation.isPending}
                className={`rounded-lg border p-3 text-left transition-smooth disabled:opacity-60 ${
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {opt.desc}
                </div>
              </button>
            );
          })}
        </div>
        {isFreeform && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            工作项可直接分配给成员或专家团，无需经过工作流管线。
          </p>
        )}
      </div>

      {/* Workflow Binding */}
      {!isFreeform && (
      <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-medium">
              <WorkflowIcon className="h-4 w-4 text-muted-foreground" />
              工作流绑定
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              为项目组绑定的工作流可在跨仓库工作项中调用
            </p>
          </div>
        </div>

      {bindingQuery.isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : binding?.workflow_id ? (
        <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm">
              <span className="text-muted-foreground">当前绑定：</span>
              <span className="font-medium">{currentWorkflowName}</span>
            </div>
            <a
              href={appPath(`/workflows/${encodeURIComponent(binding.workflow_id)}${members.length > 0 ? `?projectId=${encodeURIComponent(members[0].project_id)}` : ""}`)}
              className="mt-0.5 inline-block text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              查看工作流 →
            </a>
          </div>
          <Button
            variant="outline"
            onClick={handleUnbind}
            disabled={deleteMutation.isPending}
            className="gap-1.5"
          >
            <Unlink className="h-3.5 w-3.5" />
            {deleteMutation.isPending ? "解绑中…" : "解绑"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          未绑定工作流，绑定后可在跨仓库工作项中使用。
        </p>
      )}

      <div className="flex items-center gap-3">
        <Select
          value={selectedWfId}
          onChange={(e) => setSelectedWfId(e.target.value)}
          options={workflowOptions}
          className="flex-1"
        />
        <Button
          onClick={handleBind}
          disabled={!selectedWfId || setMutation.isPending}
        >
          {setMutation.isPending
            ? "绑定中…"
            : binding?.workflow_id
            ? "替换绑定"
            : "绑定工作流"}
        </Button>
      </div>
      </div>
      )}
    </>
  );
}

function MemberRemovalCard({
  groupId,
  members,
}: {
  groupId: string;
  members: ProjectGroupMember[];
}) {
  const removeMutation = useRemoveGroupMember(groupId);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleRemove = async (member: ProjectGroupMember) => {
    if (
      !confirm(`确定将项目 "${member.name}" 从项目组中移除？\n（不会删除该项目本身）`)
    ) {
      return;
    }
    setPendingId(member.project_id);
    try {
      await removeMutation.mutateAsync(member.project_id);
      toast({ title: "已移除项目", description: member.name });
    } catch (err) {
      toast({
        title: "移除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-medium">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          移除项目（危险操作）
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          从项目组中移除成员项目，对项目自身没有影响
        </p>
      </div>

      {members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
          暂无成员项目
        </p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg border border-border/40 bg-background/50">
          {members.map((m) => {
            const isPending = removeMutation.isPending && pendingId === m.project_id;
            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {m.name}
                    </span>
                    {m.role === "primary" ? (
                      <Badge className="gap-1">
                        <Star className="h-2.5 w-2.5" /> Primary
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Member</Badge>
                    )}
                  </div>
                  <p
                    className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                    title={m.cwd ?? undefined}
                  >
                    {m.cwd ?? "路径已不存在"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleRemove(m)}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <UserMinus className="mr-1 h-3.5 w-3.5" />
                  {isPending ? "…" : "移除"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Dialogs (reused from previous Taylor implementation) ───────────────────

function EditGroupDialog({
  open,
  groupId,
  initialName,
  initialDescription,
  onClose,
}: {
  open: boolean;
  groupId: string;
  initialName: string;
  initialDescription: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useUpdateProjectGroup();

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
      setError(null);
    }
  }, [open, initialName, initialDescription]);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("请填写项目组名称");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        groupId,
        body: {
          name: trimmed,
          description: description.trim() || undefined,
        },
      });
      toast({ title: "已更新项目组", description: trimmed });
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> 编辑项目组
          </DialogTitle>
          <DialogDescription>
            修改项目组的名称与描述。成员管理请在「成员」Tab 中操作。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              组名称<span className="ml-1 text-destructive">*</span>
            </span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：电商前后端"
              className="rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              描述
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="描述这个项目组的用途、范围等"
              className="w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              ✕ {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMemberDialog({
  open,
  groupId,
  candidates,
  excludeIds,
  primaryExists,
  onClose,
}: {
  open: boolean;
  groupId: string;
  candidates: ProjectInfo[];
  excludeIds: Set<string>;
  primaryExists: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<"member" | "primary">(
    primaryExists ? "member" : "primary",
  );
  const [error, setError] = useState<string | null>(null);

  const addMutation = useAddGroupMember(groupId);

  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedIds(new Set());
      setRole(primaryExists ? "member" : "primary");
      setError(null);
    }
  }, [open, primaryExists]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const base = candidates.filter((p) => !excludeIds.has(p.id));
    if (!kw) return base;
    return base.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.cwd.toLowerCase().includes(kw),
    );
  }, [candidates, excludeIds, search]);

  const submit = async () => {
    setError(null);
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setError("请至少选择一个项目");
      return;
    }
    if (role === "primary" && ids.length > 1) {
      setError("Primary 角色一次只能添加一个项目");
      return;
    }
    try {
      await Promise.all(
        ids.map((id) => addMutation.mutateAsync({ project_id: id, role })),
      );
      toast({
        title: "已添加成员",
        description: `成功添加 ${ids.length} 个项目`,
      });
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> 添加成员项目
          </DialogTitle>
          <DialogDescription>
            从已注册的项目中挑选一个或多个加入此项目组。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索项目名称或路径…"
              className="rounded-lg border-border/50"
            />
            <RoleToggle
              value={role}
              onChange={setRole}
              disablePrimary={primaryExists}
            />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60 bg-muted/30">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                {candidates.length === 0
                  ? "暂无可添加的项目"
                  : search
                  ? "没有匹配的项目"
                  : "全部项目已加入此组"}
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {filtered.map((p) => {
                  const active = selectedIds.has(p.id);
                  return (
                    <li
                      key={p.id}
                      onClick={() => toggleSelect(p.id)}
                      className={
                        "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors " +
                        (active
                          ? "bg-primary/5 hover:bg-primary/10"
                          : "hover:bg-muted/60")
                      }
                    >
                      <span
                        className={
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] " +
                          (active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground")
                        }
                      >
                        {active ? "✓" : ""}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {p.name}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {p.cwd}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {role === "primary" && primaryExists && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              当前已存在 primary 项目，添加新的 primary 可能被后端拒绝或自动降级。
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              ✕ {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            已选 {selectedIds.size} 个项目
          </div>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={addMutation.isPending || selectedIds.size === 0}
          >
            {addMutation.isPending ? "添加中…" : "添加选中项目"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleToggle({
  value,
  onChange,
  disablePrimary = false,
}: {
  value: "member" | "primary";
  onChange: (v: "member" | "primary") => void;
  disablePrimary?: boolean;
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-border/60 text-xs">
      {(["member", "primary"] as const).map((opt) => {
        const disabled = opt === "primary" && disablePrimary;
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            title={disabled ? "已存在 primary 项目，无法再添加" : undefined}
            onClick={() => !disabled && onChange(opt)}
            className={
              "px-3 py-1.5 font-medium uppercase tracking-wider transition-colors " +
              (disabled ? "cursor-not-allowed opacity-50 " : "") +
              (value === opt
                ? "bg-foreground text-background"
                : "bg-background text-muted-foreground hover:text-foreground")
            }
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function DeleteGroupDialog({
  open,
  name,
  memberCount,
  isPending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  name: string;
  memberCount: number;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" /> 删除项目组
          </DialogTitle>
          <DialogDescription>
            删除后将解除组内所有项目的关联，但<strong>不会删除项目本身</strong>。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Hash className="h-3.5 w-3.5 text-destructive" />
            {name}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            包含 {memberCount} 个成员项目
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            取消
          </Button>
          <Button
            variant="outline"
            onClick={onConfirm}
            disabled={isPending}
            className="border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
          >
            {isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
