"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Select } from "@tide/ui";
import {
  useProject,
  useProjectChats,
  useProjectSessions,
  useProjectTasks,
  useDeleteProject,
  useWorkflows,
  useProjectWorkflow,
  useBindProjectWorkflow,
  useUnbindProjectWorkflow,
  type ProjectSession,
  type ProjectTaskSummary,
} from "@tide/core";

type TabKey = "conversations" | "tasks" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "conversations", label: "对话" },
  { key: "tasks", label: "任务" },
  { key: "settings", label: "设置" },
];

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
