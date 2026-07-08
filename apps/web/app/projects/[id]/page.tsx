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
  apiClient,
  useAvailableUsers,
  useBatchAddProjectMembers,
  useAuth,
  useBindProjectWorkflow,
  useCleanupBranches,
  useCreateBranch,
  useCreateMergeRequest,
  useCreateVersion,
  useDeleteBranch,
  useDeleteProject,
  useDeleteVersion,
  useFetchRemote,
  useGitBranches,
  useMergeInteractive,
  useCommitMerge,
  useAbortMerge,
  useProject,
  useProjectChats,
  useProjectMembers,
  useProjectSessions,
  useProjectTasks,
  useProjectWorkflow,
  useFreeformStatusList,
  useSetFreeformStatusList,
  usePullBranch,
  usePushBranch,
  useRemoteBranches,
  useRemoveProjectMember,
  useUnbindProjectWorkflow,
  useUpdateProjectMember,
  useUpdateVersion,
  useVersions,
  useWorkflows,
  type ProjectMember,
  type ProjectSession,
  type ProjectTaskSummary,
  type Version,
  type VersionStatus,
  type FreeformStatusItem,
} from "@tide/core";
import {
  Download,
  FileCode,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
import { KnowledgeGraphCard, MergeConflictPanel, WorkflowModeGuide } from "@tide/views";

type TabKey = "conversations" | "tasks" | "versions" | "members" | "knowledge" | "branches" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "conversations", label: "对话" },
  { key: "tasks", label: "任务" },
  { key: "versions", label: "版本" },
  { key: "members", label: "成员" },
  { key: "knowledge", label: "知识图谱" },
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

      {/* Tabs — 目标顺序: 对话、任务、版本、文件、审计、分支、成员、知识图谱、设置 */}
      <nav className="flex items-center gap-0 border-b border-border/50">
        {TABS.slice(0, 3).map((t) => {
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
        {/* Route-based tabs: 文件、审计 */}
        <Link
          href={`/projects/${id}/files`}
          className="relative -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-smooth hover:text-foreground"
        >
          <FileCode className="h-3.5 w-3.5" />
          文件
        </Link>
        <Link
          href={`/projects/${id}/audit`}
          className="relative -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-smooth hover:text-foreground"
        >
          <GitBranch className="h-3.5 w-3.5" />
          审计
        </Link>
        {/* 分支 (button tab) */}
        <button
          onClick={() => setTab("branches")}
          className={[
            "relative -mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm transition-smooth",
            tab === "branches"
              ? "border-foreground text-foreground font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          <GitBranch className="h-3.5 w-3.5" />
          分支
        </button>
        {/* 剩余内部 tabs: 成员、知识图谱、设置 */}
        {TABS.slice(3).map((t) => {
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

      {tab === "versions" && <VersionsPane projectId={project.id} />}

      {tab === "branches" && (
        <div className="py-6">
          <BranchManagementCard projectId={project.id} />
        </div>
      )}

      {tab === "members" && <MembersPane projectId={project.id} />}

      {tab === "knowledge" && (
        <KnowledgeGraphCard scope="project" targetId={project.id} />
      )}

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
  const [flowMode, setFlowMode] = useState<
    "default_workflow" | "custom_workflow" | "freeform"
  >("default_workflow");
  const workflowsQuery = useWorkflows();
  const projectWfQuery = useProjectWorkflow(projectId);
  const bindMutation = useBindProjectWorkflow();
  const unbindMutation = useUnbindProjectWorkflow();

  const workflows = workflowsQuery.data ?? [];
  const enabledWorkflows = workflows.filter((w) => w.enabled);
  const currentWorkflow = projectWfQuery.data;

  // 从后端设置同步流转模式（仅在数据加载后初始化一次）
  // 使用 own_flow_mode（项目自身显式设置）回显，避免被项目组继承的 flow_mode 覆盖，
  // 否则用户选择「默认工作流」后重新进入会被误显示为项目组的自由协作模式。
  useEffect(() => {
    const ownMode = currentWorkflow?.own_flow_mode ?? currentWorkflow?.flow_mode;
    if (ownMode) {
      setFlowMode(ownMode as typeof flowMode);
    }
  }, [currentWorkflow?.own_flow_mode, currentWorkflow?.flow_mode]);

  const currentWorkflowName =
    currentWorkflow?.workflow_id
      ? workflows.find((w) => w.id === currentWorkflow.workflow_id)?.name ?? currentWorkflow.workflow_id
      : undefined;

  // 系统默认工作流（is_system === 1），用于「默认工作流」模式的只读展示
  const systemDefaultWorkflow = workflows.find((w) => w.is_system === 1);

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
      desc: "使用系统默认工作流",
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

  const handleSelectFlowMode = (
    mode: "default_workflow" | "custom_workflow" | "freeform"
  ) => {
    if (mode === flowMode) return;
    setFlowMode(mode);
    if (mode === "freeform") {
      // freeform 无需工作流，立即持久化模式
      bindMutation.mutate({ projectId, flowMode: mode });
    } else if (currentWorkflow?.workflow_id) {
      // 已绑定工作流时，切回工作流模式立即持久化
      bindMutation.mutate({
        projectId,
        workflowId: currentWorkflow.workflow_id,
        flowMode: mode,
      });
    } else if (mode === "default_workflow") {
      // 默认工作流使用系统内建工作流，无需绑定，直接持久化模式，
      // 保证选择后能正确写入并在重新进入时恢复。
      bindMutation.mutate({ projectId, flowMode: mode });
    }
    // custom_workflow 且尚未绑定工作流：暂不持久化，等待用户在下方选择并绑定。
  };

  const handleBind = () => {
    // 自定义工作流模式下必须绑定一个工作流，不能为空
    if (!selectedWfId) {
      toast({
        title: "请先选择一个工作流",
        description: "自定义工作流模式下必须绑定工作流，不能为空",
        variant: "destructive",
      });
      return;
    }
    bindMutation.mutate({ projectId, workflowId: selectedWfId, flowMode });
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

      {/* Flow Mode Selector */}
      <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-medium">工作流模式</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              选择项目下工作项的默认流转方式。
            </p>
          </div>
          <WorkflowModeGuide />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FLOW_MODE_OPTIONS.map((opt) => {
            const active = flowMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelectFlowMode(opt.value)}
                disabled={bindMutation.isPending}
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

      {/* Freeform Status List Management */}
      {isFreeform && <FreeformStatusCard projectId={projectId} />}

      {/* Workflow Binding */}
      {!isFreeform && (
        flowMode === "default_workflow" ? (
          // 默认工作流：只读展示系统默认工作流，不支持绑定/解绑
          <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
            <h2 className="text-base font-medium">工作流绑定</h2>
            <div className="text-sm">
              <span className="text-muted-foreground">当前使用系统默认工作流：</span>
              <span className="font-medium">
                {systemDefaultWorkflow?.name ?? "系统内建 4 阶段流程"}
              </span>
            </div>
            {systemDefaultWorkflow && (
              <a
                href={`/workflows/${systemDefaultWorkflow.id}?projectId=${encodeURIComponent(projectId)}`}
                className="block text-xs text-muted-foreground hover:text-foreground transition-smooth"
              >
                查看工作流 →
              </a>
            )}
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              默认工作流由系统统一管理，无需手动绑定或解绑。如需自定义流程，请切换到「自定义工作流」模式。
            </p>
          </div>
        ) : (
          // 自定义工作流：支持绑定/解绑，且必须绑定一个工作流
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
                    href={`/workflows/${currentWorkflow.workflow_id}?projectId=${encodeURIComponent(projectId)}`}
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
              <p className="text-sm text-destructive">
                自定义工作流模式下必须绑定一个工作流，请在下方选择并绑定。
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
                disabled={bindMutation.isPending}
              >
                {bindMutation.isPending ? "绑定中…" : "绑定"}
              </Button>
            </div>
          </div>
        )
      )}

      {/* Git Repository Config */}
      <GitConfigCard projectId={projectId} />



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

// ── Git Config Card ───────────────────────────────────────────────────────

interface GitConfigForm {
  repo_url: string;
  default_branch: string;
  credential_type: string;
  auto_push: boolean;
  ssh_key_path: string;
  access_token: string;
}

// ── Freeform Status List Card ───────────────────────────────────

function FreeformStatusCard({ projectId }: { projectId: string }) {
  const query = useFreeformStatusList(projectId);
  const saveMutation = useSetFreeformStatusList();
  const [list, setList] = useState<FreeformStatusItem[]>([]);

  // 后端数据加载后同步到本地可编辑状态
  useEffect(() => {
    if (query.data) setList(query.data);
  }, [query.data]);

  const updateLabel = (index: number, label: string) => {
    setList((prev) =>
      prev.map((it, i) => (i === index ? { ...it, label } : it))
    );
  };

  const updateKey = (index: number, key: string) => {
    setList((prev) =>
      prev.map((it, i) => (i === index ? { ...it, key } : it))
    );
  };

  const removeItem = (index: number) => {
    setList((prev) => prev.filter((_, i) => i !== index));
  };

  const moveItem = (index: number, dir: -1 | 1) => {
    setList((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addItem = () => {
    setList((prev) => [
      ...prev,
      { key: `status_${prev.length + 1}`, label: "新状态" },
    ]);
  };

  const handleSave = () => {
    // 校验：key 不能为空且不重复
    const cleaned = list
      .map((it) => ({ key: it.key.trim(), label: it.label.trim() }))
      .filter((it) => it.key);
    const keys = cleaned.map((it) => it.key);
    if (new Set(keys).size !== keys.length) {
      toast({ title: "状态 key 不能重复", variant: "destructive" });
      return;
    }
    if (!cleaned.some((it) => it.key === "completed")) {
      toast({ title: '必须保留终态列 "completed"', variant: "destructive" });
      return;
    }
    saveMutation.mutate(
      { projectId, statusList: cleaned },
      {
        onSuccess: (data) => {
          setList(data);
          toast({ title: "状态列表已保存" });
        },
        onError: () => toast({ title: "保存失败", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
      <div>
        <h2 className="text-base font-medium">状态列表管理</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          自定义自由协作看板的状态列。终态列 “completed” 必须保留。
        </p>
      </div>

      {query.isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => moveItem(index, -1)}
                  disabled={index === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label="上移"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(index, 1)}
                  disabled={index === list.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label="下移"
                >
                  ▼
                </button>
              </div>
              <Input
                value={item.key}
                onChange={(e) => updateKey(index, e.target.value)}
                placeholder="key"
                className="w-40 font-mono text-xs"
                disabled={item.key === "completed"}
              />
              <Input
                value={item.label}
                onChange={(e) => updateLabel(index, e.target.value)}
                placeholder="显示名称"
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeItem(index)}
                disabled={item.key === "completed"}
                aria-label="删除"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-1 h-4 w-4" />
              添加状态
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const DEFAULT_GIT_CONFIG: GitConfigForm = {
  repo_url: "",
  default_branch: "main",
  credential_type: "ssh_agent",
  auto_push: true,
  ssh_key_path: "",
  access_token: "",
};

const CREDENTIAL_OPTIONS = [
  { value: "ssh_agent", label: "SSH Agent（默认）" },
  { value: "ssh_key", label: "SSH 私钥文件" },
  { value: "token", label: "HTTPS Access Token" },
];

function GitConfigCard({ projectId }: { projectId: string }) {
  const [form, setForm] = useState<GitConfigForm>(DEFAULT_GIT_CONFIG);
  const [initial, setInitial] = useState<GitConfigForm>(DEFAULT_GIT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    apiClient
      .get<Partial<GitConfigForm>>(
        `/api/projects/${encodeURIComponent(projectId)}/git-config`,
      )
      .then((data) => {
        if (cancelled) return;
        const merged: GitConfigForm = {
          repo_url: data?.repo_url ?? "",
          default_branch: data?.default_branch ?? "",
          credential_type: data?.credential_type ?? "ssh_agent",
          auto_push: data?.auto_push ?? true,
          ssh_key_path: data?.ssh_key_path ?? "",
          access_token: data?.access_token ?? "",
        };
        setForm(merged);
        setInitial(merged);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const dirty = useMemo(
    () =>
      form.repo_url !== initial.repo_url ||
      form.default_branch !== initial.default_branch ||
      form.credential_type !== initial.credential_type ||
      form.ssh_key_path !== initial.ssh_key_path ||
      form.access_token !== initial.access_token,
    [form, initial],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        repo_url: form.repo_url.trim(),
        default_branch: form.default_branch.trim(),
        credential_type: form.credential_type,
        auto_push: initial.auto_push,
      };
      if (form.credential_type === "ssh_key") {
        payload.ssh_key_path = form.ssh_key_path.trim() || null;
      } else if (form.credential_type === "token") {
        payload.access_token = form.access_token.trim() || null;
      }
      await apiClient.put(
        `/api/projects/${encodeURIComponent(projectId)}/git-config`,
        payload,
      );
      const next: GitConfigForm = {
        ...form,
        repo_url: (payload.repo_url as string) ?? "",
        default_branch: (payload.default_branch as string) ?? "",
        // 未选中的认证方式的敏感字段由后端清零，这里也同步置空以避免表单脏状态
        ssh_key_path:
          form.credential_type === "ssh_key" ? form.ssh_key_path.trim() : "",
        access_token:
          form.credential_type === "token" ? form.access_token.trim() : "",
      };
      setForm(next);
      setInitial(next);
    } catch (err) {
      toast({
        title: "保存失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async () => {
    setCloning(true);
    try {
      await apiClient.post(`/api/projects/${encodeURIComponent(projectId)}/clone`, {});
      toast({ title: "已触发克隆", description: "请稍后刷新页面查看状态" });
    } catch (err) {
      toast({
        title: "克隆触发失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setCloning(false);
    }
  };

  const handleDeleteRepository = async () => {
    setDeleting(true);
    try {
      await apiClient.del(`/api/projects/${encodeURIComponent(projectId)}/clone`);
      toast({ title: "仓库已删除", description: "可重新克隆仓库" });
    } catch (err) {
      toast({
        title: "删除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
      <div>
        <h2 className="text-base font-medium">Git 仓库配置</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          配置项目主仓库信息，工作流节点（如 git_merge）可复用该配置。
        </p>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">加载中…</div>
      ) : loadError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          加载失败：{loadError}
        </div>
      ) : (
        <>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              仓库地址
            </span>
            <Input
              value={form.repo_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, repo_url: e.target.value }))
              }
              placeholder="git@github.com:org/repo.git"
              className="rounded-lg border-border/50 font-mono text-xs"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              默认分支
            </span>
            <Input
              value={form.default_branch}
              onChange={(e) =>
                setForm((f) => ({ ...f, default_branch: e.target.value }))
              }
              placeholder="留空则使用仓库默认分支"
              className="rounded-lg border-border/50 font-mono text-xs"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              认证方式
            </span>
            <Select
              value={form.credential_type}
              onChange={(e) =>
                setForm((f) => ({ ...f, credential_type: e.target.value }))
              }
              options={CREDENTIAL_OPTIONS}
              className="rounded-lg border-border/50"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {form.credential_type === "ssh_agent" &&
                "使用宿主上已加载的 ssh-agent，无需额外配置。"}
              {form.credential_type === "ssh_key" &&
                "使用指定私钥文件进行 SSH 认证。请确保容器内可访问该路径。"}
              {form.credential_type === "token" &&
                "使用 HTTPS Personal Access Token 鉴权（GitHub/GitLab/Gitea）。"}
            </span>
          </label>

          {/* URL 与认证方式匹配校验提示 */}
          {form.repo_url.trim() && form.credential_type && (() => {
            const url = form.repo_url.trim();
            const isSshUrl = url.startsWith("git@");
            const isHttpUrl = url.startsWith("https://") || url.startsWith("http://");
            const isSshAuth = form.credential_type === "ssh_agent" || form.credential_type === "ssh_key";
            const isHttpAuth = form.credential_type === "token";

            if (isSshAuth && isHttpUrl) {
              return (
                <p className="text-xs text-amber-500 -mt-2">
                  ⚠️ 当前认证方式为 SSH，但仓库 URL 为 HTTPS 格式，clone 可能失败。建议使用 git@ 开头的 SSH URL。
                </p>
              );
            }
            if (isHttpAuth && isSshUrl) {
              return (
                <p className="text-xs text-amber-500 -mt-2">
                  ⚠️ 当前认证方式为 HTTPS Token，但仓库 URL 为 SSH 格式，clone 可能失败。建议使用 https:// 开头的 URL。
                </p>
              );
            }
            return null;
          })()}

          {form.credential_type === "ssh_key" && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                私钥路径
              </span>
              <Input
                value={form.ssh_key_path}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ssh_key_path: e.target.value }))
                }
                placeholder="/root/.ssh/id_rsa"
                className="rounded-lg border-border/50 font-mono text-xs"
              />
            </label>
          )}

          {form.credential_type === "token" && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                Access Token
              </span>
              <Input
                type="password"
                value={form.access_token}
                onChange={(e) =>
                  setForm((f) => ({ ...f, access_token: e.target.value }))
                }
                placeholder="ghp_xxxxxxxxxxxxxxxx"
                className="rounded-lg border-border/50 font-mono text-xs"
                autoComplete="new-password"
              />
              <span className="mt-1 block text-[11px] text-amber-600/80">
                令牌以明文形式存储于项目设置 metadata 中，请将权限最小化。
              </span>
            </label>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={cloning || !form.repo_url.trim()}
                onClick={handleClone}
              >
                {cloning ? "克隆中…" : "克隆仓库"}
              </Button>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={() => {
                  if (
                    window.confirm(
                      "确定删除仓库文件？这将删除整个工作区（包括所有分支和工作目录），此操作不可恢复，但可以重新克隆。",
                    )
                  ) {
                    handleDeleteRepository();
                  }
                }}
              >
                {deleting ? "删除中…" : "删除仓库"}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={!dirty || saving}
                onClick={() => setForm(initial)}
              >
                重置
              </Button>
              <Button onClick={handleSave} disabled={!dirty || saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Branch Management Card ────────────────────────────────────────────────

function BranchManagementCard({ projectId }: { projectId: string }) {
  const { data: branchData } = useGitBranches(projectId);
  const branches = branchData?.branches ?? [];
  const currentBranch = branchData?.current ?? "";

  const createBranch = useCreateBranch(projectId);
  const deleteBranch = useDeleteBranch(projectId);
  const cleanupBranches = useCleanupBranches(projectId);
  const fetchRemote = useFetchRemote(projectId);
  const pushBranch = usePushBranch(projectId);
  const pullBranch = usePullBranch(projectId);
  const createMR = useCreateMergeRequest(projectId);

  const { data: remoteBranchesData } = useRemoteBranches(projectId);
  const remoteBranchSet = new Set(remoteBranchesData?.branches ?? []);
  const mergeInteractive = useMergeInteractive(projectId);
  const commitMergeMutation = useCommitMerge(projectId);
  const abortMergeMutation = useAbortMerge(projectId);

  // 合并本地和远端分支，去重，用于本地合并弹窗
  const remoteBranches = remoteBranchesData?.branches ?? [];
  const remoteOnlyBranches = remoteBranches.filter(b => !branches.includes(b));
  const allMergeBranches = [...branches, ...remoteOnlyBranches];

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [mrDialogBranch, setMrDialogBranch] = useState<string | null>(null);
  const [mrTitle, setMrTitle] = useState("");
  const [mrTargetBranch, setMrTargetBranch] = useState("");
  const [mrDescription, setMrDescription] = useState("");

  // Merge 弹窗 state
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

  const handleCreateBranch = () => {
    if (!newBranchName.trim()) return;
    createBranch.mutate(
      { branchName: newBranchName.trim() },
      {
        onSuccess: () => {
          toast({ title: "分支已创建", description: newBranchName.trim() });
          setNewBranchName("");
          setShowCreateForm(false);
        },
        onError: (err) => {
          toast({ title: "创建失败", description: getApiErrorMessage(err), variant: "destructive" });
        },
      },
    );
  };

  const handlePush = (branch: string) => {
    pushBranch.mutate(
      { branchName: branch },
      {
        onSuccess: () => toast({ title: "Push 成功", description: branch }),
        onError: (err) => toast({ title: "Push 失败", description: getApiErrorMessage(err), variant: "destructive" }),
      },
    );
  };

  const handlePull = (branch: string) => {
    pullBranch.mutate(
      { branchName: branch },
      {
        onSuccess: () => toast({ title: "Pull 成功", description: branch }),
        onError: (err) => toast({ title: "Pull 失败", description: getApiErrorMessage(err), variant: "destructive" }),
      },
    );
  };

  const handleDelete = (branch: string) => {
    if (!confirm(`确定删除分支 "${branch}" 吗？此操作不可恢复。`)) return;
    deleteBranch.mutate(
      branch,
      {
        onSuccess: () => toast({ title: "分支已删除", description: branch }),
        onError: (err) => toast({ title: "删除失败", description: getApiErrorMessage(err), variant: "destructive" }),
      },
    );
  };

  const handleCreateMR = () => {
    if (!mrDialogBranch || !mrTargetBranch || mrDialogBranch === mrTargetBranch) return;
    createMR.mutate(
      {
        source_branch: mrDialogBranch,
        target_branch: mrTargetBranch,
        title: mrTitle || `Merge ${mrDialogBranch} into ${mrTargetBranch}`,
        description: mrDescription || undefined,
      },
      {
        onSuccess: (data) => {
          const url = (data as { url?: string })?.url;
          toast({ title: "MR 已创建", description: url ?? "操作成功" });
          setMrDialogBranch(null);
          setMrTitle("");
          setMrTargetBranch("");
          setMrDescription("");
        },
        onError: (err) => {
          toast({ title: "MR 创建失败", description: getApiErrorMessage(err), variant: "destructive" });
        },
      },
    );
  };

  const openMrDialog = (branch: string) => {
    setMrDialogBranch(branch);
    const remoteBranches = remoteBranchesData?.branches ?? [];
    const otherRemote = remoteBranches.filter((b) => b !== branch);
    const defaultTarget = otherRemote.includes("main") ? "main" : otherRemote.includes("master") ? "master" : otherRemote[0] ?? "";
    setMrTargetBranch(defaultTarget);
    setMrTitle(`Merge ${branch} into ${defaultTarget}`);
    setMrDescription("");
  };

  return (
    <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium">本地分支管理</h2>
          <Badge variant="secondary" className="text-xs">{branches.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={fetchRemote.isPending}
            onClick={() => {
              fetchRemote.mutate(undefined, {
                onSuccess: () => toast({ title: "Fetch 完成", description: "远端分支信息已同步" }),
                onError: (err) => toast({ title: "Fetch 失败", description: getApiErrorMessage(err), variant: "destructive" }),
              });
            }}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${fetchRemote.isPending ? "animate-spin" : ""}`} />
            {fetchRemote.isPending ? "同步中…" : "Fetch"}
          </Button>
          {branches.some((b) => b.startsWith("tide/")) && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={cleanupBranches.isPending}
              onClick={() => {
                if (!confirm("确定清理所有 tide/ 前缀的工作分支吗？将同时删除关联的 worktree。")) return;
                cleanupBranches.mutate(undefined, {
                  onSuccess: (data) => toast({ title: "清理完成", description: `已删除 ${(data as { cleaned: number }).cleaned} 个分支` }),
                  onError: (err) => toast({ title: "清理失败", description: getApiErrorMessage(err), variant: "destructive" }),
                });
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {cleanupBranches.isPending ? "清理中…" : "清理工作分支"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
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
            onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
          />
          <Button size="sm" onClick={handleCreateBranch} disabled={createBranch.isPending || !newBranchName.trim()}>
            {createBranch.isPending ? "创建中…" : "创建"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setShowCreateForm(false); setNewBranchName(""); }}>
            取消
          </Button>
        </div>
      )}

      {/* Branch List */}
      <div className="max-h-[400px] overflow-y-auto space-y-1">
        {branches.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">暂无分支信息</p>
        ) : (
          branches.map((branch) => (
            <div
              key={branch}
              className="group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs truncate">{branch}</span>
                {branch === currentBranch && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0">当前</Badge>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title="Push"
                  onClick={() => handlePush(branch)}
                >
                  <Upload className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title="Pull"
                  onClick={() => handlePull(branch)}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title="本地合并"
                  onClick={() => { setMergeSource(branch); setMergeTarget(""); setMergeDialogOpen(true); }}
                >
                  <GitMerge className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title={remoteBranchSet.has(branch) ? "Merge Request" : "分支未推送到远端，请先 Push"}
                  disabled={!remoteBranchSet.has(branch)}
                  onClick={() => openMrDialog(branch)}
                >
                  <GitPullRequest className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  title="删除分支"
                  disabled={branch === currentBranch}
                  onClick={() => handleDelete(branch)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* MR Dialog */}
      {mrDialogBranch && (
        <Dialog open onOpenChange={(open) => { if (!open) { setMrDialogBranch(null); setMrTitle(""); setMrTargetBranch(""); setMrDescription(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建 Merge Request</DialogTitle>
              <DialogDescription>从 {mrDialogBranch} 合并到目标分支</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">源分支</span>
                <Select
                  value={mrDialogBranch}
                  onChange={(e) => {
                    const newSource = e.target.value;
                    setMrDialogBranch(newSource);
                    setMrTitle(`Merge ${newSource} into ${mrTargetBranch}`);
                    if (newSource === mrTargetBranch) {
                      setMrTargetBranch("");
                    }
                  }}
                  options={(remoteBranchesData?.branches ?? []).filter((b) => b !== mrTargetBranch).map((b) => ({ value: b, label: b }))}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">目标分支</span>
                <Select
                  value={mrTargetBranch}
                  onChange={(e) => {
                    const newTarget = e.target.value;
                    setMrTargetBranch(newTarget);
                    setMrTitle(`Merge ${mrDialogBranch} into ${newTarget}`);
                    if (newTarget === mrDialogBranch) {
                      setMrDialogBranch("");
                    }
                  }}
                  options={(remoteBranchesData?.branches ?? []).filter((b) => b !== mrDialogBranch).map((b) => ({ value: b, label: b }))}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">标题</span>
                <Input
                  value={mrTitle}
                  onChange={(e) => setMrTitle(e.target.value)}
                  placeholder={`Merge ${mrDialogBranch} into ${mrTargetBranch}`}
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
              <Button variant="outline" onClick={() => { setMrDialogBranch(null); setMrTitle(""); setMrTargetBranch(""); setMrDescription(""); }}>
                取消
              </Button>
              <Button onClick={handleCreateMR} disabled={createMR.isPending || !mrDialogBranch || !mrTargetBranch || mrDialogBranch === mrTargetBranch}>
                {createMR.isPending ? "创建中…" : "创建 MR"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Local Merge Dialog */}
      {mergeDialogOpen && (
        <Dialog open onOpenChange={(open) => { if (!open) setMergeDialogOpen(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>本地分支合并</DialogTitle>
              <DialogDescription>
                将源分支合并到目标分支（本地操作）
              </DialogDescription>
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
              <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>
                取消
              </Button>
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
          projectId={projectId}
          cwd={mergeConflictData.cwd}
          sourceBranch={mergeConflictData.sourceBranch}
          targetBranch={mergeConflictData.targetBranch}
          conflictFiles={mergeConflictData.conflicts}
          onCommitMerge={async () => {
            await commitMergeMutation.mutateAsync({
              message: `Merge ${mergeConflictData.sourceBranch} into ${mergeConflictData.targetBranch} (conflicts resolved)`,
              delete_source: mergeConflictData.deleteSource ? mergeConflictData.sourceBranch : "",
            });
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

// ── Members Tab ───────────────────────────────────────────────────────────

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
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);

  const batchMutation = useBatchAddProjectMembers(projectId);

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
      setSelectedUserIds(new Set());
      setRole("member");
      setError(null);
    }
  }, [open]);

  const usersQuery = useAvailableUsers(projectId, debounced || undefined);

  const candidates = useMemo(() => {
    const list = usersQuery.data?.items ?? [];
    return list.filter((u) => !excludeIds.has(u.id));
  }, [usersQuery.data, excludeIds]);

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
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
      const result = await batchMutation.mutateAsync({
        user_ids: Array.from(selectedUserIds),
        role,
      });
      toast({
        title: "添加成功",
        description: `已添加 ${result.added.length} 名成员${result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 名` : ""}`,
      });
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
            <UserPlus className="h-4 w-4" /> 添加项目成员
          </DialogTitle>
          <DialogDescription>
            选择用户加入到当前项目，并指定项目内的角色。支持多选。
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
            {usersQuery.isLoading ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                加载中…
              </div>
            ) : usersQuery.isError ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                加载用户列表失败
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                {debounced ? "没有匹配的用户" : "暂无可添加的用户"}
              </div>
            ) : (
              <ul className="divide-y divide-border/50">
                {candidates.map((u) => {
                  const checked = selectedUserIds.has(u.id);
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => toggleUser(u.id)}
                        className={[
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-smooth",
                          checked
                            ? "bg-indigo-500/10 text-foreground"
                            : "hover:bg-muted/60",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          className="h-4 w-4 rounded border-border accent-indigo-500"
                        />
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
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
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {selectedUserIds.size > 0 && (
            <div className="text-xs text-muted-foreground">
              已选 {selectedUserIds.size} 名用户
            </div>
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
            disabled={selectedUserIds.size === 0 || batchMutation.isPending}
            onClick={submit}
          >
            {batchMutation.isPending
              ? "添加中…"
              : selectedUserIds.size > 0
                ? `添加 ${selectedUserIds.size} 名成员`
                : "添加成员"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Versions Tab ───────────────────────────────────────────────────

const VERSION_STATUS_OPTIONS: { value: VersionStatus; label: string }[] = [
  { value: "active", label: "活跃" },
  { value: "released", label: "已发布" },
  { value: "archived", label: "已归档" },
];

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

function VersionsPane({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const isGlobalAdmin = user?.role === "admin";
  const isViewer = user?.role === "viewer";

  const membersQuery = useProjectMembers(projectId);
  const myProjectRole = useMemo(() => {
    if (!user) return null;
    return (
      membersQuery.data?.members.find((m) => m.id === user.id)?.project_role ??
      null
    );
  }, [membersQuery.data, user]);
  const canManage =
    !isViewer &&
    (isGlobalAdmin ||
      myProjectRole === "admin" ||
      myProjectRole === "member");

  const versionsQuery = useVersions(projectId);
  const versions = versionsQuery.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Version | null>(null);

  const createMutation = useCreateVersion();
  const updateMutation = useUpdateVersion();
  const deleteMutation = useDeleteVersion();

  const handleDelete = async (v: Version) => {
    if (
      !confirm(
        `确认删除版本 “${v.name}”？\n关联的工作项会保留，但不再关联该版本。`,
      )
    )
      return;
    try {
      await deleteMutation.mutateAsync(v.id);
    } catch (err) {
      toast({
        title: "删除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">项目版本</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            为项目维护版本，工作项可选择关联某个版本 · 共 {versions.length} 个
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Tag className="h-4 w-4" /> 新建版本
          </Button>
        )}
      </div>

      {versionsQuery.isLoading ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : versionsQuery.isError ? (
        <div className="bg-card rounded-xl shadow-card py-12 text-center text-sm text-destructive">
          加载失败：{getApiErrorMessage(versionsQuery.error)}
        </div>
      ) : versions.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card border border-border/50 py-16 text-center">
          <Tag
            className="mx-auto h-8 w-8 text-muted-foreground/60"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm text-muted-foreground">该项目暂无版本</p>
          {canManage && (
            <Button
              className="mt-5 gap-1.5"
              onClick={() => setCreateOpen(true)}
            >
              <Tag className="h-4 w-4" /> 创建第一个版本
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">描述</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {versions.map((v) => (
                <tr key={v.id} className="hover:bg-muted/40 transition-smooth">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{v.name}</span>
                    </div>
                  </td>
                  <td className="max-w-[420px] truncate px-4 py-3 text-muted-foreground">
                    {v.description || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={VERSION_STATUS_VARIANT[v.status] ?? "outline"}
                    >
                      {VERSION_STATUS_LABEL[v.status] ?? v.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {formatTime(v.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditing(v)}
                            title="编辑版本"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(v)}
                            title="删除版本"
                            disabled={deleteMutation.isPending}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <VersionFormDialog
        open={createOpen}
        title="新建版本"
        submitting={createMutation.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (form) => {
          await createMutation.mutateAsync({
            project_id: projectId,
            name: form.name,
            description: form.description || undefined,
            status: form.status,
          });
          setCreateOpen(false);
        }}
      />

      <VersionFormDialog
        open={!!editing}
        title="编辑版本"
        initial={editing ?? undefined}
        submitting={updateMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={async (form) => {
          if (!editing) return;
          await updateMutation.mutateAsync({
            id: editing.id,
            data: {
              name: form.name,
              description: form.description || "",
              status: form.status,
            },
          });
          setEditing(null);
        }}
      />
    </section>
  );
}

function VersionFormDialog({
  open,
  title,
  initial,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial?: Version;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (form: {
    name: string;
    description: string;
    status: VersionStatus;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<VersionStatus>("active");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setStatus((initial?.status as VersionStatus) ?? "active");
      setError(null);
    }
  }, [open, initial]);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名称不能为空");
      return;
    }
    try {
      await onSubmit({
        name: trimmed,
        description: description.trim(),
        status,
      });
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" /> {title}
          </DialogTitle>
          <DialogDescription>
            为项目创建或维护一个版本，供工作项在创建时选择关联。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              名称 <span className="text-destructive">*</span>
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：v1.0.0 / 2026Q3"
              className="rounded-lg border-border/50"
              autoFocus
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
              placeholder="可选的版本说明"
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              状态
            </span>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as VersionStatus)}
              options={VERSION_STATUS_OPTIONS}
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
          <Button disabled={submitting} onClick={submit}>
            {submitting ? "提交中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
