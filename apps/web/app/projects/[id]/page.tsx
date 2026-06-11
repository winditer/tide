"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
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
  useAdminUsers,
  useAddProjectMember,
  useAuth,
  useBindProjectWorkflow,
  useDeleteProject,
  useProject,
  useProjectChats,
  useProjectMembers,
  useProjectSessions,
  useProjectTasks,
  useProjectWorkflow,
  useRemoveProjectMember,
  useUnbindProjectWorkflow,
  useUpdateProjectMember,
  useWorkflows,
  type ProjectMember,
  type ProjectSession,
  type ProjectTaskSummary,
} from "@tide/core";
import {
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";

type TabKey = "conversations" | "tasks" | "members" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "conversations", label: "对话" },
  { key: "tasks", label: "任务" },
  { key: "members", label: "成员" },
  { key: "settings", label: "设置" },
];

const PROJECT_ROLE_OPTIONS = [
  { value: "admin", label: "管理员 (admin)" },
  { value: "member", label: "成员 (member)" },
  { value: "viewer", label: "只读 (viewer)" },
];

const PROJECT_ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  member: "成员",
  viewer: "只读",
};

function getApiErrorMessage(err: unknown): string {
  const e = err as { body?: unknown; message?: string };
  if (e?.body && typeof e.body === "object") {
    const detail = (e.body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return e?.message ?? String(err);
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "secondary",
  running: "default",
  review: "outline",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  approved: "secondary",
  rejected: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  review: "待审批",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  approved: "已批准",
  rejected: "已拒绝",
};

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

function shortId(id: string | null | undefined, head = 8, tail = 4) {
  if (!id) return "—";
  return id.length > head + tail + 2 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
}

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("conversations");

  const projectQuery = useProject(id);
  const sessionsQuery = useProjectSessions(id);
  const chatsQuery = useProjectChats(id);
  const tasksQuery = useProjectTasks(id);
  const deleteMutation = useDeleteProject();

  const project = projectQuery.data;

  if (projectQuery.isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2">
        <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
      </main>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2">
        <div className="bg-card rounded-xl shadow-card p-8 text-center">
          <p className="text-base font-medium text-destructive">项目不存在或加载失败</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push("/projects")}
          >
            ← 返回项目列表
          </Button>
        </div>
      </main>
    );
  }

  const sessions = sessionsQuery.data?.sessions ?? [];
  const chats = chatsQuery.data?.chats ?? [];
  const tasks = tasksQuery.data?.tasks ?? [];

  return (
    <main className="mx-auto max-w-7xl px-2 py-2 space-y-8">
      {/* Hero */}
      <header>
        <button
          onClick={() => router.push("/projects")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-smooth"
        >
          ← 返回项目列表
        </button>

        <div className="mt-3 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={project.status === "active" ? "default" : "secondary"}>
                {project.status === "active" ? "活跃" : "空闲"}
              </Badge>
              {project.registered && (
                <Badge variant="outline">已注册</Badge>
              )}
            </div>
            <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {project.cwd}
            </p>
            {project.tags && project.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {project.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3 md:w-[520px]">
            <StatBlock label="任务" value={project.task_count} />
            <StatBlock label="会话" value={project.session_count} />
            <StatBlock label="对话" value={project.chat_count ?? 0} />
            <StatBlock label="Agents" value={project.agents.length} />
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
        <ConversationsPane
          sessions={sessions}
          chats={chats}
          isSessionsLoading={sessionsQuery.isLoading}
          isSessionsError={sessionsQuery.isError}
          isChatsLoading={chatsQuery.isLoading}
          isChatsError={chatsQuery.isError}
          projectCwd={project.cwd}
        />
      )}

      {tab === "tasks" && (
        <TasksPane
          tasks={tasks}
          isLoading={tasksQuery.isLoading}
          isError={tasksQuery.isError}
        />
      )}

      {tab === "members" && <MembersPane projectId={project.id} />}

      {tab === "settings" && (
        <SettingsPane
          projectId={project.id}
          projectName={project.name}
          cwd={project.cwd}
          registered={project.registered}
          tags={project.tags}
          isRemoving={deleteMutation.isPending}
          onRemove={async () => {
            if (!project.registered) return;
            if (!confirm(`从已知项目列表中移除 “${project.name}” ？\n（不会删除文件）`)) {
              return;
            }
            await deleteMutation.mutateAsync(project.id);
            router.push("/projects");
          }}
        />
      )}
    </main>
  );
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card rounded-xl shadow-card px-3 py-3 text-center">
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ConversationsPane({
  sessions,
  chats,
  isSessionsLoading,
  isSessionsError,
  isChatsLoading,
  isChatsError,
  projectCwd,
}: {
  sessions: ProjectSession[];
  chats: ProjectSession[];
  isSessionsLoading: boolean;
  isSessionsError: boolean;
  isChatsLoading: boolean;
  isChatsError: boolean;
  projectCwd: string;
}) {
  return (
    <div className="space-y-10">
      <SessionsSection
        title="项目会话"
        subtitle="与该项目根目录绑定的 Agent 会话（来自本地会话文件）"
        emptyText="暂无项目会话"
        items={sessions}
        isLoading={isSessionsLoading}
        isError={isSessionsError}
        rightLink={
          <a
            href={`/sessions?project=${encodeURIComponent(projectCwd)}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-smooth"
          >
            查看全部会话 →
          </a>
        }
      />

      <SessionsSection
        title="相关普通对话"
        subtitle="未绑定项目，但内容引用了该项目的 chat（按内容路径匹配）"
        emptyText="暂无相关对话"
        items={chats}
        isLoading={isChatsLoading}
        isError={isChatsError}
      />
    </div>
  );
}

function SessionsSection({
  title,
  subtitle,
  emptyText,
  items,
  isLoading,
  isError,
  rightLink,
}: {
  title: string;
  subtitle: string;
  emptyText: string;
  items: ProjectSession[];
  isLoading: boolean;
  isError: boolean;
  rightLink?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {rightLink}
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
      ) : isError ? (
        <div className="py-8 text-center text-sm text-destructive">加载失败</div>
      ) : items.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden">
          <ul className="divide-y divide-border/50">
            {items.map((s) => (
              <li key={`${s.agent_id}-${s.session_id}`}>
                <Link
                  href={`/sessions/${encodeURIComponent(s.session_id)}`}
                  className="flex items-start gap-4 p-4 cursor-pointer hover:bg-muted/50 transition-smooth"
                >
                  <div className="flex w-20 flex-col items-start gap-1">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {s.agent_id || "agent"}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {shortId(s.session_id)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {s.title || s.session_id || "未命名会话"}
                    </p>
                    {s.cwd && s.cwd !== s.project_root && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        ↳ {s.cwd}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[11px]">
                    <div className="font-mono text-muted-foreground">{formatTime(s.last_active)}</div>
                    <div className="mt-1 font-mono uppercase tracking-wider text-muted-foreground">
                      {s.status}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function TasksPane({
  tasks,
  isLoading,
  isError,
}: {
  tasks: ProjectTaskSummary[];
  isLoading: boolean;
  isError: boolean;
}) {
  const router = useRouter();
  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">加载任务中…</div>
    );
  }
  if (isError) {
    return (
      <div className="py-12 text-center text-sm text-destructive">加载任务失败</div>
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">任务</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">通过 Lark 面板或 Web 工作台主动下发的执行指令</p>
        </div>
      </div>

      {tasks.length === 0 ? (
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
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {tasks.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer hover:bg-muted/50 transition-smooth"
                  onClick={() => router.push(`/tasks/${t.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {shortId(t.id)}
                  </td>
                  <td className="max-w-[420px] truncate px-4 py-3">
                    {t.prompt || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.agent_id || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {formatTime(t.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SettingsPane({
  projectId,
  projectName,
  cwd,
  registered,
  tags,
  isRemoving,
  onRemove,
}: {
  projectId: string;
  projectName: string;
  cwd: string;
  registered: boolean;
  tags: string[];
  isRemoving: boolean;
  onRemove: () => void;
}) {
  const [selectedWfId, setSelectedWfId] = useState("");
  const workflowsQuery = useWorkflows();
  const projectWfQuery = useProjectWorkflow(projectId);
  const bindMutation = useBindProjectWorkflow();
  const unbindMutation = useUnbindProjectWorkflow();

  const workflows = workflowsQuery.data ?? [];
  const enabledWorkflows = workflows.filter((w) => w.enabled);
  const currentWorkflow = projectWfQuery.data;
  const currentWorkflowName =
    currentWorkflow?.workflow_id
      ? workflows.find((w) => w.id === currentWorkflow.workflow_id)?.name ?? currentWorkflow.workflow_id
      : undefined;

  const workflowOptions = [
    { value: "", label: "-- 选择工作流 --" },
    ...enabledWorkflows.map((wf) => ({ value: wf.id, label: wf.name })),
  ];

  const handleBind = () => {
    if (!selectedWfId) return;
    bindMutation.mutate({ projectId, workflowId: selectedWfId });
  };

  const handleUnbind = () => {
    unbindMutation.mutate(projectId);
  };

  return (
    <section className="space-y-6">
      <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            项目名称
          </div>
          <div className="mt-1 text-base font-medium">{projectName}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">工作目录</div>
          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{cwd}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            项目 ID
          </div>
          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{projectId}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">标签</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {tags && tags.length > 0 ? (
              tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  #{t}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            注册状态
          </div>
          <div className="mt-1 text-sm">
            {registered ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                已注册到工作台
              </span>
            ) : (
              <span className="text-muted-foreground">仅由文件扫描发现，未注册</span>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Binding */}
      <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <h2 className="text-base font-medium">工作流绑定</h2>
        {currentWorkflow?.workflow_id ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">
                <span className="text-muted-foreground">当前绑定：</span>
                <span className="font-medium">{currentWorkflowName}</span>
              </div>
              <a
                href={`/workflows/${currentWorkflow.workflow_id}`}
                className="text-xs text-muted-foreground hover:text-foreground transition-smooth"
              >
                查看工作流 →
              </a>
            </div>
            <Button
              variant="outline"
              onClick={handleUnbind}
              disabled={unbindMutation.isPending}
            >
              {unbindMutation.isPending ? "解绑中…" : "解绑"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            未绑定工作流，绑定后可在工作项看板中使用。
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
            disabled={!selectedWfId || bindMutation.isPending}
          >
            {bindMutation.isPending ? "绑定中…" : "绑定"}
          </Button>
        </div>
      </div>

      {registered && (
        <div className="bg-card rounded-xl shadow-card border border-destructive/30 p-6 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-destructive">危险区</div>
            <p className="mt-1 text-sm">
              从已知项目列表中移除（不会删除文件）
            </p>
          </div>
          <Button
            variant="destructive"
            disabled={isRemoving}
            onClick={onRemove}
          >
            {isRemoving ? "移除中…" : "移除项目"}
          </Button>
        </div>
      )}
    </section>
  );
}

// ── Members Tab ───────────────────────────────────────────────────────────

function MembersPane({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const isGlobalAdmin = user?.role === "admin";

  const membersQuery = useProjectMembers(projectId);
  const updateMutation = useUpdateProjectMember(projectId);
  const removeMutation = useRemoveProjectMember(projectId);

  const [addOpen, setAddOpen] = useState(false);

  const members = membersQuery.data?.members ?? [];
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  // Determine if the current user can manage members.
  const myProjectRole = useMemo(() => {
    if (!user) return null;
    return members.find((m) => m.id === user.id)?.project_role ?? null;
  }, [members, user]);
  const canManage = isGlobalAdmin || myProjectRole === "admin";

  const handleRoleChange = async (member: ProjectMember, role: string) => {
    if (role === member.project_role) return;
    try {
      await updateMutation.mutateAsync({
        userId: member.id,
        body: { role },
      });
      toast({
        title: "已更新角色",
        description: `${member.username} → ${PROJECT_ROLE_LABEL[role] ?? role}`,
      });
    } catch (err) {
      toast({
        title: "更新失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const handleRemove = async (member: ProjectMember) => {
    if (!confirm(`将 ${member.username} 从该项目移除？`)) return;
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
          <h2 className="text-lg font-semibold">项目成员</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            管理可访问该项目的用户与各自的角色 · 共 {members.length} 人
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
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-muted-foreground">
            该项目暂无成员
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
                <th className="px-4 py-3 font-medium">项目角色</th>
                <th className="px-4 py-3 font-medium">加入时间</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {members.map((m) => {
                const isSelf = user?.id === m.id;
                return (
                  <tr key={m.id} className="hover:bg-muted/40 transition-smooth">
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
                          value={m.project_role}
                          onChange={(e) => handleRoleChange(m, e.target.value)}
                          options={PROJECT_ROLE_OPTIONS}
                          disabled={updateMutation.isPending}
                          className="h-8 w-36 rounded-md border-border/50 text-xs"
                        />
                      ) : (
                        <Badge variant="secondary">
                          {PROJECT_ROLE_LABEL[m.project_role] ?? m.project_role}
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

      <AddMemberDialog
        projectId={projectId}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        excludeIds={memberIds}
      />
    </section>
  );
}

function AddMemberDialog({
  projectId,
  open,
  onClose,
  excludeIds,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  excludeIds: Set<string>;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);

  const addMutation = useAddProjectMember(projectId);

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setDebounced("");
      setSelectedUserId(null);
      setRole("member");
      setError(null);
    }
  }, [open]);

  // Only admins can list /api/admin/users; for non-admins this query will 403,
  // but project admins typically aren't given /admin/users access. We use the
  // admin search for convenience when available.
  const usersQuery = useAdminUsers({
    q: debounced || undefined,
    page: 1,
    page_size: 20,
  });

  const candidates = useMemo(() => {
    const list = usersQuery.data?.users ?? [];
    return list.filter((u) => !excludeIds.has(u.id));
  }, [usersQuery.data, excludeIds]);

  const submit = async () => {
    setError(null);
    if (!selectedUserId) {
      setError("请选择一名用户");
      return;
    }
    try {
      await addMutation.mutateAsync({ user_id: selectedUserId, role });
      const picked = candidates.find((u) => u.id === selectedUserId);
      toast({
        title: "已添加成员",
        description: picked?.username ?? selectedUserId,
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
            <UserPlus className="h-4 w-4" /> 添加项目成员
          </DialogTitle>
          <DialogDescription>
            选择一个已有用户加入到当前项目，并指定项目内的角色。
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
                  const active = selectedUserId === u.id;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(u.id)}
                        className={[
                          "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-smooth",
                          active
                            ? "bg-indigo-500/10 text-foreground"
                            : "hover:bg-muted/60",
                        ].join(" ")}
                      >
                        <div className="flex min-w-0 items-center gap-2">
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
                value={selectedUserId ?? ""}
                onChange={(e) => setSelectedUserId(e.target.value || null)}
                placeholder="粘贴目标用户的 UUID"
                className="rounded-lg border-border/50 font-mono text-xs"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              项目角色
            </span>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={PROJECT_ROLE_OPTIONS}
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
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!selectedUserId || addMutation.isPending}
            onClick={submit}
          >
            {addMutation.isPending ? "添加中…" : "添加成员"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
