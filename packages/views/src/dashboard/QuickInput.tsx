"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Select } from "@tide/ui";
import {
  fetchSessionsForProject,
  useAgents,
  useCreateTaskMutation,
  useProjects,
  type SessionItem,
} from "@tide/core";

const AGENT_LABEL: Record<string, string> = {
  codex: "CX",
  claude: "CC",
  qoder: "QO",
};

const AGENT_BADGE_CLASS: Record<string, string> = {
  codex: "bg-emerald-500/15 text-emerald-600",
  claude: "bg-amber-500/15 text-amber-600",
  qoder: "bg-sky-500/15 text-sky-600",
};

function formatSessionDate(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return sameYear
    ? `${month}-${day} ${hh}:${mm}`
    : `${d.getFullYear()}-${month}-${day}`;
}

export function QuickInput() {
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("");
  const [cwd, setCwd] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionList, setSessionList] = useState<SessionItem[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [defaultApplied, setDefaultApplied] = useState(false);

  const projectBoxRef = useRef<HTMLDivElement>(null);
  const sessionBoxRef = useRef<HTMLDivElement>(null);

  const { data: agentsData } = useAgents();
  const projectsQuery = useProjects();
  const createMutation = useCreateTaskMutation();

  const projects = projectsQuery.data?.projects ?? [];

  const agentOptions = [
    { label: "自动", value: "" },
    ...(agentsData?.agents.map((a) => ({ label: a.name, value: a.id })) ?? []),
  ];

  // 默认选中最近活跃项目
  useEffect(() => {
    if (defaultApplied) return;
    if (!projects.length) return;
    const sorted = [...projects].sort((a, b) => {
      const at = a.last_active ? new Date(a.last_active).getTime() : 0;
      const bt = b.last_active ? new Date(b.last_active).getTime() : 0;
      return bt - at;
    });
    const top = sorted.find((p) => p.status === "active") ?? sorted[0];
    if (top) setCwd(top.cwd);
    setDefaultApplied(true);
  }, [projects, defaultApplied]);

  // 关闭项目下拉
  useEffect(() => {
    if (!projectOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        projectBoxRef.current &&
        !projectBoxRef.current.contains(e.target as Node)
      ) {
        setProjectOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [projectOpen]);

  // 关闭会话下拉
  useEffect(() => {
    if (!sessionOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        sessionBoxRef.current &&
        !sessionBoxRef.current.contains(e.target as Node)
      ) {
        setSessionOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sessionOpen]);

  // cwd 变化时重置并加载会话
  useEffect(() => {
    setSessionId("");
    setSessionError(null);
    if (!cwd) {
      setSessionList([]);
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    fetchSessionsForProject(cwd)
      .then((res) => {
        if (cancelled) return;
        setSessionList(res.sessions ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setSessionList([]);
        setSessionError(err instanceof Error ? err.message : "加载会话失败");
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.cwd === cwd) ?? null,
    [projects, cwd]
  );

  const selectedSession = useMemo(
    () => sessionList.find((s) => s.id === sessionId) ?? null,
    [sessionList, sessionId]
  );

  const groupedSessions = useMemo(() => {
    const project: SessionItem[] = [];
    const chat: SessionItem[] = [];
    for (const s of sessionList) {
      if (s.type === "chat") chat.push(s);
      else project.push(s);
    }
    return { project, chat };
  }, [sessionList]);

  function handleSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    createMutation.mutate(
      {
        prompt: trimmed,
        agent_id: agentId || undefined,
        cwd: cwd || undefined,
        session_id: sessionId || undefined,
      },
      {
        onSuccess: () => {
          setPrompt("");
          setSessionId("");
        },
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function pickProject(path: string) {
    setCwd(path);
    setProjectOpen(false);
  }

  function clearProject() {
    setCwd("");
    setProjectOpen(false);
  }

  function pickSession(id: string) {
    setSessionId(id);
    setSessionOpen(false);
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 shadow-sm">
      {/* 上下文栏：模式 + 项目 + 会话 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* 模式指示 */}
        {selectedProject ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-primary"
            />
            项目：{selectedProject.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
            />
            Chat 模式
          </span>
        )}

        {/* 项目选择 */}
        <div className="relative" ref={projectBoxRef}>
          <button
            type="button"
            onClick={() => setProjectOpen((v) => !v)}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span className="max-w-[8rem] truncate">
              {selectedProject ? selectedProject.name : "选择项目"}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="opacity-60"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {projectOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-1 max-h-72 w-72 overflow-auto rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-md">
              <button
                type="button"
                onClick={clearProject}
                className={
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
                  (cwd === "" ? "bg-accent/60" : "")
                }
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-dashed border-muted-foreground/60 text-[11px] text-muted-foreground">
                  ∅
                </span>
                <span className="font-medium">不选项目</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  Chat 模式
                </span>
              </button>
              {projectsQuery.isLoading && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  加载项目中...
                </div>
              )}
              {projects.length > 0 && (
                <div className="mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  项目
                </div>
              )}
              {projects.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => pickProject(p.cwd)}
                  className={
                    "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
                    (cwd === p.cwd ? "bg-accent/60" : "")
                  }
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.status === "active" && (
                      <span className="ml-auto inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    )}
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {p.cwd}
                  </span>
                </button>
              ))}
              {!projectsQuery.isLoading && projects.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  暂无项目
                </div>
              )}
            </div>
          )}
        </div>

        {/* 会话选择（项目选中时启用） */}
        {selectedProject && (
          <div className="relative" ref={sessionBoxRef}>
            <button
              type="button"
              onClick={() => setSessionOpen((v) => !v)}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="max-w-[10rem] truncate">
                {selectedSession
                  ? selectedSession.title || selectedSession.id
                  : "新建会话"}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="opacity-60"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {sessionOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-1 max-h-72 w-80 overflow-auto rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-md">
                <button
                  type="button"
                  onClick={() => pickSession("")}
                  className={
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
                    (sessionId === "" ? "bg-accent/60" : "")
                  }
                >
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-dashed border-muted-foreground/60 text-[11px] text-muted-foreground">
                    +
                  </span>
                  <span className="font-medium">新建会话</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    默认
                  </span>
                </button>

                {sessionLoading && (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    加载会话中...
                  </div>
                )}
                {sessionError && !sessionLoading && (
                  <div className="px-2 py-2 text-xs text-destructive">
                    {sessionError}
                  </div>
                )}

                {!sessionLoading && !sessionError && groupedSessions.project.length > 0 && (
                  <>
                    <div className="mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Sessions · 项目会话
                    </div>
                    {groupedSessions.project.map((s) => (
                      <SessionRow
                        key={`p-${s.id}`}
                        item={s}
                        active={sessionId === s.id}
                        onPick={pickSession}
                      />
                    ))}
                  </>
                )}

                {!sessionLoading && !sessionError && groupedSessions.chat.length > 0 && (
                  <>
                    <div className="mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Chats · 普通对话
                    </div>
                    {groupedSessions.chat.map((s) => (
                      <SessionRow
                        key={`c-${s.id}`}
                        item={s}
                        active={sessionId === s.id}
                        onPick={pickSession}
                      />
                    ))}
                  </>
                )}

                {!sessionLoading &&
                  !sessionError &&
                  groupedSessions.project.length === 0 &&
                  groupedSessions.chat.length === 0 && (
                    <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                      该项目下暂无历史会话
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="flex items-end gap-3">
        <textarea
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={2}
          placeholder={
            selectedProject
              ? `在「${selectedProject.name}」中执行... (Ctrl+Enter 提交)`
              : "输入指令进行普通对话... (Ctrl+Enter 提交)"
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="w-28 shrink-0">
          <Select
            options={agentOptions}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={!prompt.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? "提交中..." : "执行"}
        </Button>
      </div>
    </div>
  );
}

interface SessionRowProps {
  item: SessionItem;
  active: boolean;
  onPick: (id: string) => void;
}

function SessionRow({ item, active, onPick }: SessionRowProps) {
  const badgeClass =
    AGENT_BADGE_CLASS[item.agent_id] ?? "bg-muted text-muted-foreground";
  const label =
    AGENT_LABEL[item.agent_id] ?? item.agent_id.slice(0, 2).toUpperCase();
  return (
    <button
      type="button"
      onClick={() => onPick(item.id)}
      title={item.title || item.id}
      className={
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
        (active ? "bg-accent/60" : "")
      }
    >
      <span
        className={
          "inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold tracking-wide " +
          badgeClass
        }
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {item.title || (
          <span className="text-muted-foreground">(无标题)</span>
        )}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatSessionDate(item.created_at)}
      </span>
    </button>
  );
}
