"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardContent } from "@tide/ui";
import {
  useProject,
  useProjectChats,
  useProjectSessions,
  useProjectTasks,
  useDeleteProject,
  type ProjectSession,
  type ProjectTaskSummary,
} from "@tide/core";

type TabKey = "conversations" | "tasks" | "settings";

const TABS: { key: TabKey; label: string; mono: string }[] = [
  { key: "conversations", label: "Conversations", mono: "CONVOS" },
  { key: "tasks", label: "Tasks", mono: "TASKS" },
  { key: "settings", label: "Settings", mono: "CONFIG" },
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
        <div className="py-16 text-center font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING…
        </div>
      </main>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <main className="mx-auto max-w-7xl px-2 py-2">
        <div className="border-2 border-rose-500 bg-rose-50 p-8 text-center">
          <div className="font-mono text-[11px] tracking-widest text-rose-600">
            ✕ PROJECT NOT FOUND
          </div>
          <p className="mt-2 font-serif text-xl text-zinc-800">项目不存在或加载失败</p>
          <Button
            variant="outline"
            className="mt-4 border-2 border-zinc-900"
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
    <main className="mx-auto max-w-7xl px-2 py-2">
      {/* Hero */}
      <header className="mb-8 border-b-2 border-zinc-900 pb-6">
        <button
          onClick={() => router.push("/projects")}
          className="mb-4 font-mono text-[11px] tracking-widest text-zinc-500 hover:text-zinc-900"
        >
          ← BACK · PROJECTS
        </button>

        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.4em] text-zinc-500">
              <span>WORKSPACE · PROJECT</span>
              <span
                className={
                  project.status === "active"
                    ? "rounded-sm bg-emerald-600 px-2 py-0.5 text-white"
                    : "rounded-sm bg-zinc-200 px-2 py-0.5 text-zinc-700"
                }
              >
                {project.status === "active" ? "ACTIVE" : "IDLE"}
              </span>
              {project.registered && (
                <span className="rounded-sm border border-zinc-900 px-2 py-0.5 text-zinc-900">
                  REGISTERED
                </span>
              )}
            </div>
            <h1 className="mt-2 truncate font-serif text-5xl font-bold leading-none tracking-tight text-zinc-900">
              {project.name}
              <span className="text-emerald-600">.</span>
            </h1>
            <p className="mt-3 break-all font-mono text-xs text-zinc-600">
              {project.cwd}
            </p>
            {project.tags && project.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {project.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-sm border border-zinc-300 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-700"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3 md:w-[520px]">
            <StatBlock label="TASKS" value={project.task_count} />
            <StatBlock label="SESSIONS" value={project.session_count} />
            <StatBlock label="CHATS" value={project.chat_count ?? 0} />
            <StatBlock label="AGENTS" value={project.agents.length} />
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="mb-6 flex items-center gap-0 border-b border-zinc-300">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                "relative -mb-px border-b-2 px-5 py-2.5 transition-colors",
                active
                  ? "border-emerald-600 text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-800",
              ].join(" ")}
            >
              <span className="font-serif text-base">{t.label}</span>
              <span className="ml-2 font-mono text-[10px] tracking-widest text-zinc-400">
                {t.mono}
              </span>
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
    <div className="border-2 border-zinc-900 bg-white px-3 py-3 text-center shadow-[3px_3px_0_0_rgba(24,24,27,0.9)]">
      <div className="font-serif text-3xl font-bold text-zinc-900">{value}</div>
      <div className="font-mono text-[10px] tracking-widest text-zinc-500">{label}</div>
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
        monoLabel="SESSIONS"
        emptyText="NO PROJECT SESSIONS YET"
        items={sessions}
        isLoading={isSessionsLoading}
        isError={isSessionsError}
        rightLink={
          <a
            href={`/sessions?project=${encodeURIComponent(projectCwd)}`}
            className="font-mono text-[11px] tracking-widest text-zinc-500 hover:text-zinc-900"
          >
            ALL SESSIONS →
          </a>
        }
      />

      <SessionsSection
        title="相关普通对话"
        subtitle="未绑定项目，但内容引用了该项目的 chat（按内容路径匹配）"
        monoLabel="CHATS"
        emptyText="NO RELATED CHATS"
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
  monoLabel,
  emptyText,
  items,
  isLoading,
  isError,
  rightLink,
}: {
  title: string;
  subtitle: string;
  monoLabel: string;
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
          <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
            {monoLabel} · {items.length}
          </div>
          <h2 className="mt-1 font-serif text-2xl font-semibold text-zinc-900">{title}</h2>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        {rightLink}
      </div>

      {isLoading ? (
        <div className="py-8 text-center font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING…
        </div>
      ) : isError ? (
        <div className="py-8 text-center font-mono text-xs text-rose-600">
          ✕ FAILED TO LOAD
        </div>
      ) : items.length === 0 ? (
        <div className="border-2 border-dashed border-zinc-300 py-12 text-center font-mono text-[11px] tracking-widest text-zinc-400">
          {emptyText}
        </div>
      ) : (
        <Card className="border-2 border-zinc-900 shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
          <CardContent className="p-0">
            <ul className="divide-y divide-zinc-200">
              {items.map((s) => (
                <li
                  key={`${s.agent_id}-${s.session_id}`}
                  className="flex items-start gap-4 p-4 transition-colors hover:bg-zinc-50"
                >
                  <div className="flex w-20 flex-col items-start gap-1">
                    <span className="rounded-sm border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-700">
                      {s.agent_id || "agent"}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {shortId(s.session_id)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-base text-zinc-900">
                      {s.title || s.session_id || "未命名会话"}
                    </p>
                    {s.cwd && s.cwd !== s.project_root && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                        ↳ {s.cwd}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[11px]">
                    <div className="font-mono text-zinc-500">{formatTime(s.last_active)}</div>
                    <div className="mt-1 font-mono uppercase tracking-wider text-zinc-400">
                      {s.status}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
      <div className="py-12 text-center font-mono text-xs tracking-widest text-zinc-500">
        ◐ LOADING TASKS…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="py-12 text-center font-mono text-xs text-rose-600">
        ✕ FAILED TO LOAD TASKS
      </div>
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-zinc-900">任务</h2>
          <p className="text-xs text-zinc-500">通过 Lark 面板或 Web 工作台主动下发的执行指令</p>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="border-2 border-dashed border-zinc-300 py-16 text-center font-mono text-[11px] tracking-widest text-zinc-400">
          NO TASKS YET
        </div>
      ) : (
        <Card className="border-2 border-zinc-900 shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">PROMPT</th>
                  <th className="px-4 py-3">AGENT</th>
                  <th className="px-4 py-3">STATUS</th>
                  <th className="px-4 py-3">CREATED</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr
                    key={t.id}
                    className="cursor-pointer border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                    onClick={() => router.push(`/tasks/${t.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700">
                      {shortId(t.id)}
                    </td>
                    <td className="max-w-[420px] truncate px-4 py-3 text-zinc-900">
                      {t.prompt || "—"}
                    </td>
                    <td className="px-4 py-3">{t.agent_id || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {formatTime(t.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
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
  return (
    <section className="space-y-6">
      <Card className="border-2 border-zinc-900 shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
        <CardContent className="space-y-4 p-6">
          <div>
            <div className="font-mono text-[10px] tracking-widest text-zinc-500">
              PROJECT NAME
            </div>
            <div className="mt-1 font-serif text-xl text-zinc-900">{projectName}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-widest text-zinc-500">CWD</div>
            <div className="mt-1 break-all font-mono text-xs text-zinc-700">{cwd}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-widest text-zinc-500">
              PROJECT ID
            </div>
            <div className="mt-1 break-all font-mono text-xs text-zinc-700">{projectId}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-widest text-zinc-500">TAGS</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {tags && tags.length > 0 ? (
                tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-sm border border-zinc-300 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-700"
                  >
                    #{t}
                  </span>
                ))
              ) : (
                <span className="font-mono text-xs text-zinc-400">—</span>
              )}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-widest text-zinc-500">
              REGISTRATION
            </div>
            <div className="mt-1 text-sm text-zinc-700">
              {registered ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  已注册到工作台
                </span>
              ) : (
                <span className="text-zinc-500">仅由文件扫描发现，未注册</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {registered && (
        <Card className="border-2 border-rose-500 bg-rose-50 shadow-[6px_6px_0_0_rgba(225,29,72,0.4)]">
          <CardContent className="flex items-center justify-between p-6">
            <div>
              <div className="font-mono text-[10px] tracking-widest text-rose-600">
                DANGER · ZONE
              </div>
              <p className="mt-1 font-serif text-base text-zinc-900">
                从已知项目列表中移除（不会删除文件）
              </p>
            </div>
            <Button
              disabled={isRemoving}
              onClick={onRemove}
              className="border-2 border-zinc-900 bg-rose-600 text-white shadow-[3px_3px_0_0_rgba(24,24,27,1)] hover:bg-rose-700"
            >
              {isRemoving ? "移除中…" : "移除项目"}
            </Button>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
