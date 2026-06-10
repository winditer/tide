"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
} from "@tide/ui";
import {
  useAgents,
  useCreateSessionMutation,
  useProjects,
  useSessionsQuery,
  useArchiveSessionMutation,
  useUnarchiveSessionMutation,
  type SessionInfo,
} from "@tide/core";

type SessionRow = SessionInfo & {
  title?: string | null;
  project_name?: string | null;
  project_root?: string | null;
  source?: string;
  archived?: boolean;
};

const AGENT_LABEL: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  qoder: "Qoder",
};

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

function relativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} 天前`;
    return new Date(iso).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  } catch {
    return iso;
  }
}

function shortenId(id: string | null | undefined) {
  if (!id) return "—";
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function deriveProjectKey(session: SessionRow): string {
  return (
    session.project_root ||
    session.cwd ||
    "未关联项目"
  );
}

function deriveProjectName(session: SessionRow): string {
  if (session.project_name) return session.project_name;
  const cwd = session.project_root || session.cwd;
  if (!cwd) return "未关联项目";
  const parts = cwd.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || cwd;
}

export default function SessionsPage() {
  const router = useRouter();

  const [tab, setTab] = useState<"project" | "chat">("project");
  const [project, setProject] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [creating, setCreating] = useState<null | "convo" | "chat">(null);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  const { data: projects } = useProjects();
  const { data: agents } = useAgents();
  const archiveMutation = useArchiveSessionMutation();
  const unarchiveMutation = useUnarchiveSessionMutation();

  // 项目会话（项目/Agent 过滤生效）
  const projectQuery = useSessionsQuery({
    type: "project",
    project: project || undefined,
    agent_id: agentId || undefined,
    page_size: 200,
    show_archived: showArchived,
  });

  // 普通对话（仅 Agent 过滤生效，不绑项目）
  const chatQuery = useSessionsQuery({
    type: "chat",
    agent_id: agentId || undefined,
    page_size: 200,
    show_archived: showArchived,
  });

  const active = tab === "project" ? projectQuery : chatQuery;
  const { data, isLoading, isError, refetch } = active;

  const sessions = (data?.sessions ?? []) as SessionRow[];
  const projectCount = projectQuery.data?.total ?? 0;
  const chatCount = chatQuery.data?.total ?? 0;

  const grouped = useMemo(() => {
    if (tab !== "project") return [];
    const map = new Map<
      string,
      { name: string; cwd: string; sessions: SessionRow[] }
    >();
    for (const s of sessions) {
      const key = deriveProjectKey(s);
      const name = deriveProjectName(s);
      const entry = map.get(key);
      if (entry) {
        entry.sessions.push(s);
      } else {
        map.set(key, { name, cwd: key, sessions: [s] });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const ta = a.sessions[0]?.last_active ?? "";
      const tb = b.sessions[0]?.last_active ?? "";
      return tb.localeCompare(ta);
    });
  }, [sessions, tab]);

  const flatChats = useMemo(() => {
    if (tab !== "chat") return [] as SessionRow[];
    return [...sessions].sort((a, b) =>
      String(b.last_active ?? "").localeCompare(String(a.last_active ?? ""))
    );
  }, [sessions, tab]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-6 border-b border-zinc-200 pb-5">
        <div>
          <div className="font-mono text-[10px] tracking-[0.32em] text-zinc-500">
            CHATS · /sessions
          </div>
          <h1 className="mt-1 font-serif text-3xl tracking-tight text-zinc-900">
            会话
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            浏览本地 Agent 的项目会话与普通对话，点击进入详情。
          </p>
        </div>
        <Button onClick={() => setCreating(tab === "chat" ? "chat" : "convo")} className="shrink-0">
          ＋ 新建{tab === "chat" ? "对话" : "会话"}
        </Button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="会话类型"
        className="inline-flex items-stretch border border-zinc-900 bg-white shadow-[3px_3px_0_0_rgba(24,24,27,0.92)]"
      >
        <TabButton
          active={tab === "project"}
          onClick={() => setTab("project")}
          label="Sessions"
          sub="项目会话"
          count={projectCount}
        />
        <TabButton
          active={tab === "chat"}
          onClick={() => setTab("chat")}
          label="Chats"
          sub="普通对话"
          count={chatCount}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50/60 px-4 py-3">
        <span className="font-mono text-[10px] tracking-widest text-zinc-500">
          FILTERS
        </span>
        {tab === "project" && (
          <div className="min-w-[220px]">
            <Select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              options={[
                { label: "全部项目", value: "" },
                ...((projects?.projects ?? []).map((p) => ({
                  label: p.name,
                  value: p.cwd,
                }))),
              ]}
            />
          </div>
        )}
        <div className="min-w-[160px]">
          <Select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            options={[
              { label: "全部 Agent", value: "" },
              ...((agents?.agents ?? []).map((a) => ({
                label: a.name || a.id,
                value: a.id,
              }))),
            ]}
          />
        </div>
        {((tab === "project" && project) || agentId) && (
          <button
            type="button"
            onClick={() => {
              setProject("");
              setAgentId("");
            }}
            className="font-mono text-[10px] tracking-widest text-zinc-700 underline-offset-4 hover:underline"
          >
            ✕ CLEAR
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className={
            "font-mono text-[10px] tracking-widest underline-offset-4 hover:underline " +
            (showArchived ? "text-amber-700" : "text-zinc-700")
          }
        >
          {showArchived ? "◉ 隐藏归档" : "○ 显示归档"}
        </button>
        <div className="ml-auto text-xs text-muted-foreground">
          共 {data?.total ?? 0} 个{tab === "project" ? "项目会话" : "普通对话"}
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            加载中…
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-destructive">
            加载失败
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                重试
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : tab === "project" ? (
        grouped.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              暂无匹配的项目会话
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {grouped.map((group) => (
              <section key={group.cwd}>
                <header className="mb-3 flex items-baseline justify-between">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[10px] tracking-[0.28em] text-zinc-500">
                      PROJECT
                    </span>
                    <h2 className="font-serif text-lg text-zinc-900">
                      {group.name}
                    </h2>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {group.sessions.length} sessions
                    </span>
                  </div>
                  <span className="hidden truncate font-mono text-[11px] text-zinc-400 md:block">
                    {group.cwd}
                  </span>
                </header>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.sessions.map((s) => (
                    <SessionCard
                      key={`${s.session_id}-${s.source ?? "?"}`}
                      session={s}
                      isArchiving={
                        (archiveMutation.isPending || unarchiveMutation.isPending) &&
                        pendingArchiveId === s.session_id
                      }
                      onOpen={() => router.push(`/sessions/${encodeURIComponent(s.session_id)}`)}
                      onToggleArchive={async () => {
                        setPendingArchiveId(s.session_id);
                        try {
                          if (s.archived) {
                            await unarchiveMutation.mutateAsync(s.session_id);
                          } else {
                            await archiveMutation.mutateAsync(s.session_id);
                          }
                        } finally {
                          setPendingArchiveId(null);
                        }
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : flatChats.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center text-sm text-muted-foreground">
            <span>暂无普通对话</span>
            <Button onClick={() => setCreating("chat")} size="sm">
              ＋ 开启首个对话
            </Button>
          </CardContent>
        </Card>
      ) : (
        <section>
          <header className="mb-3 flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-[10px] tracking-[0.28em] text-zinc-500">
              CHATS
            </span>
            <h2 className="font-serif text-lg text-zinc-900">普通对话</h2>
            <span className="font-mono text-[11px] text-zinc-400">
              {flatChats.length} chats
            </span>
            <button
              type="button"
              onClick={() => setCreating("chat")}
              className="ml-auto inline-flex items-center gap-1.5 border border-zinc-900 bg-white px-3 py-1.5 font-mono text-[10px] tracking-widest text-zinc-900 shadow-[2px_2px_0_0_rgba(24,24,27,0.92)] transition hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_0_rgba(24,24,27,0.92)]"
            >
              <span aria-hidden>＋</span> NEW CHAT
            </button>
          </header>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {flatChats.map((s) => (
              <SessionCard
                key={`${s.session_id}-${s.source ?? "?"}`}
                session={s}
                isArchiving={
                  (archiveMutation.isPending || unarchiveMutation.isPending) &&
                  pendingArchiveId === s.session_id
                }
                onOpen={() => router.push(`/sessions/${encodeURIComponent(s.session_id)}`)}
                onToggleArchive={async () => {
                  setPendingArchiveId(s.session_id);
                  try {
                    if (s.archived) {
                      await unarchiveMutation.mutateAsync(s.session_id);
                    } else {
                      await archiveMutation.mutateAsync(s.session_id);
                    }
                  } finally {
                    setPendingArchiveId(null);
                  }
                }}
              />
            ))}
          </div>
        </section>
      )}

      {creating && (
        <CreateSessionDialog
          defaultType={creating}
          onClose={() => setCreating(null)}
          onCreated={(sid) => {
            setCreating(null);
            router.push(`/sessions/${encodeURIComponent(sid)}`);
          }}
        />
      )}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  count: number;
}

function TabButton({ active, onClick, label, sub, count }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "flex items-center gap-3 px-5 py-2.5 transition-colors focus-visible:outline-none " +
        (active
          ? "bg-zinc-900 text-zinc-50"
          : "bg-white text-zinc-700 hover:bg-zinc-100")
      }
    >
      <span className="font-mono text-[11px] tracking-[0.24em]">{label}</span>
      <span
        className={
          "font-serif text-[12px] " +
          (active ? "text-zinc-300" : "text-zinc-500")
        }
      >
        {sub}
      </span>
      <span
        className={
          "min-w-[1.5rem] rounded-sm px-1.5 py-0.5 text-center font-mono text-[10px] " +
          (active
            ? "bg-zinc-50 text-zinc-900"
            : "bg-zinc-100 text-zinc-700")
        }
      >
        {count}
      </span>
    </button>
  );
}

interface SessionCardProps {
  session: SessionRow;
  onOpen: () => void;
  isArchiving?: boolean;
  onToggleArchive?: () => void;
}

function SessionCard({ session, onOpen, isArchiving, onToggleArchive }: SessionCardProps) {
  const title =
    session.title ||
    `Session ${shortenId(session.session_id)}`;
  const status = (session.last_status as string) || "completed";
  const archived = !!session.archived;
  return (
    <div
      className={
        "group relative flex h-full flex-col gap-3 rounded-md border p-4 text-left transition " +
        (archived
          ? "border-zinc-300 bg-zinc-50 opacity-80 hover:border-zinc-500"
          : "border-zinc-200 bg-white hover:border-zinc-900 hover:shadow-[3px_3px_0_0_rgba(24,24,27,0.92)]")
      }
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col gap-3 text-left focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="line-clamp-2 font-serif text-[15px] leading-snug text-zinc-900">
            {title}
          </div>
          {archived ? (
            <Badge variant="outline" className="shrink-0 border-zinc-400 text-[10px] text-zinc-500">
              已归档
            </Badge>
          ) : (
            <Badge
              variant={STATUS_VARIANT[status] ?? "outline"}
              className="shrink-0 text-[10px]"
            >
              {STATUS_LABEL[status] ?? status}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {session.agent_id && (
            <span className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-zinc-700">
              {AGENT_LABEL[session.agent_id] ?? session.agent_id}
            </span>
          )}
          <span className="font-mono text-[10px] text-zinc-400">
            {shortenId(session.session_id)}
          </span>
          {session.task_count > 0 && (
            <span className="font-mono text-[10px] text-zinc-500">
              · {session.task_count} 任务
            </span>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between text-[11px] text-zinc-500">
          <span>{relativeTime(session.last_active)}</span>
          <span className="font-mono tracking-widest text-zinc-400 transition group-hover:text-zinc-900">
            OPEN →
          </span>
        </div>
      </button>
      {onToggleArchive && (
        <button
          type="button"
          disabled={isArchiving}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleArchive();
          }}
          className="absolute right-2 top-2 rounded-sm border border-zinc-300 bg-white/90 px-2 py-0.5 font-mono text-[10px] tracking-wider text-zinc-600 opacity-0 transition hover:border-amber-500 hover:text-amber-600 group-hover:opacity-100 disabled:opacity-50"
        >
          {isArchiving ? "…" : archived ? "UNARCHIVE" : "ARCHIVE"}
        </button>
      )}
    </div>
  );
}

interface CreateSessionDialogProps {
  onClose: () => void;
  onCreated: (sessionId: string) => void;
  defaultType?: "convo" | "chat";
}

function CreateSessionDialog({ onClose, onCreated, defaultType = "convo" }: CreateSessionDialogProps) {
  const { data: projects } = useProjects();
  const { data: agents } = useAgents();
  const create = useCreateSessionMutation();

  const projectOptions = (projects?.projects ?? []).map((p) => ({
    label: `${p.name}  ·  ${p.cwd}`,
    value: p.cwd,
  }));
  const agentOptions = (agents?.agents ?? []).map((a) => ({
    label: a.name || a.id,
    value: a.id,
  }));

  const defaultProject = projectOptions[0]?.value ?? "";
  const defaultAgent = agentOptions[0]?.value ?? "codex";

  const [sessionType, setSessionType] = useState<"convo" | "chat">(defaultType);
  const [projectCwd, setProjectCwd] = useState<string>(defaultProject);
  const [agentId, setAgentId] = useState<string>(defaultAgent);
  const [title, setTitle] = useState<string>("");

  const isChat = sessionType === "chat";
  const canSubmit = isChat ? true : Boolean((projectCwd || "").trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cwd = (projectCwd || "").trim();
    if (!isChat && !cwd) return;
    try {
      const result = await create.mutateAsync({
        session_type: sessionType,
        project_cwd: isChat ? "" : cwd,
        agent_id: agentId || "codex",
        title: title.trim() || undefined,
      });
      onCreated(result.session_id);
    } catch {
      /* error surfaced below */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 px-4"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg space-y-5 border border-zinc-900 bg-white p-6 shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] tracking-[0.32em] text-zinc-500">
              {isChat ? "NEW CHAT" : "NEW SESSION"}
            </div>
            <h3 className="font-serif text-xl text-zinc-900">
              {isChat ? "开启新对话" : "开启新会话"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-zinc-500 hover:text-zinc-900"
          >
            ✕
          </button>
        </div>

        {/* Type segmented toggle */}
        <div
          role="radiogroup"
          aria-label="会话类型"
          className="grid grid-cols-2 border border-zinc-900 bg-white text-left"
        >
          <TypeToggle
            active={!isChat}
            onClick={() => setSessionType("convo")}
            code="CONVO"
            label="项目会话"
            hint="绑定 cwd"
          />
          <TypeToggle
            active={isChat}
            onClick={() => setSessionType("chat")}
            code="CHAT"
            label="普通对话"
            hint="不绑项目"
          />
        </div>

        <div className="space-y-3">
          {!isChat && (
            <div>
              <label className="mb-1 block font-mono text-[10px] tracking-widest text-zinc-500">
                PROJECT
              </label>
              {projectOptions.length > 0 ? (
                <Select
                  value={projectCwd}
                  onChange={(e) => setProjectCwd(e.target.value)}
                  options={projectOptions}
                />
              ) : (
                <Input
                  value={projectCwd}
                  onChange={(e) => setProjectCwd(e.target.value)}
                  placeholder="/absolute/path/to/project"
                />
              )}
            </div>
          )}
          {isChat && (
            <p className="border-l-2 border-zinc-900 bg-zinc-50 px-3 py-2 font-mono text-[10px] leading-relaxed tracking-wider text-zinc-600">
              CHAT 不绑定项目，运行于全局工作目录。适合快问快答与临时任务。
            </p>
          )}
          <div>
            <label className="mb-1 block font-mono text-[10px] tracking-widest text-zinc-500">
              AGENT
            </label>
            <Select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              options={
                agentOptions.length > 0
                  ? agentOptions
                  : [
                      { label: "Codex", value: "codex" },
                      { label: "Claude", value: "claude" },
                      { label: "Qoder", value: "qoder" },
                    ]
              }
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] tracking-widest text-zinc-500">
              TITLE / PROMPT (可选)
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isChat ? "对话主题或首条提问" : "开场白或会话主题"}
            />
          </div>
        </div>

        {create.isError && (
          <p className="font-mono text-[11px] text-rose-600">
            创建失败：{String(create.error)}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !canSubmit}
          >
            {create.isPending ? "创建中…" : isChat ? "▶ 开启对话" : "▶ 创建会话"}
          </Button>
        </div>

        <Link
          href="/projects"
          className="block text-right font-mono text-[10px] tracking-widest text-zinc-500 hover:underline"
        >
          管理项目 →
        </Link>
      </form>
    </div>
  );
}

interface TypeToggleProps {
  active: boolean;
  onClick: () => void;
  code: string;
  label: string;
  hint: string;
}

function TypeToggle({ active, onClick, code, label, hint }: TypeToggleProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={
        "flex flex-col gap-1 px-4 py-3 text-left transition-colors focus-visible:outline-none " +
        (active
          ? "bg-zinc-900 text-zinc-50"
          : "bg-white text-zinc-700 hover:bg-zinc-100")
      }
    >
      <span
        className={
          "font-mono text-[10px] tracking-[0.32em] " +
          (active ? "text-zinc-300" : "text-zinc-500")
        }
      >
        {code}
      </span>
      <span className="font-serif text-base leading-none">{label}</span>
      <span
        className={
          "font-mono text-[10px] tracking-wider " +
          (active ? "text-zinc-400" : "text-zinc-500")
        }
      >
        {hint}
      </span>
    </button>
  );
}
