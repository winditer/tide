"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Button, Input, Select } from "@tide/ui";
import {
  fetchSessionsForProject,
  uploadTaskAttachments,
  useCreateTaskMutation,
  useProjects,
  useProjectGroups,
  useAgents,
  type CreateTaskParams,
  type SessionItem,
} from "@tide/core";

// 本地 Agent 的默认显示名（仅用于无法从 /api/agents 取得时的兵底）
const FALLBACK_AGENT_OPTIONS = [
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude" },
  { label: "Qoder CLI", value: "qoder" },
];

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

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 10;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

interface TaskCreateFormProps {
  onSuccess?: () => void;
}

interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  isImage: boolean;
  previewUrl?: string;
  status: "uploading" | "done" | "error";
  remotePath?: string;
  error?: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function TaskCreateForm({ onSuccess }: TaskCreateFormProps) {
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("codex");
  const [model, setModel] = useState("");
  /**
   * 统一作用域编码：
   * - ``"project:<cwd>"`` -> 单仓库，后端使用 cwd
   * - ``"group:<id>"``    -> 项目组，后端根据 group_id 注入多仓库上下文
   * - ``""``              -> 未选（需后端默认 cwd）
   */
  const [scopeValue, setScopeValue] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionList, setSessionList] = useState<SessionItem[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionBoxRef = useRef<HTMLDivElement>(null);
  const previewUrlsRef = useRef<string[]>([]);

  const createMutation = useCreateTaskMutation();
  const projectsQuery = useProjects();
  const projects = projectsQuery.data?.projects ?? [];
  const groupsQuery = useProjectGroups();
  const groups = groupsQuery.data?.groups ?? [];

  // 从统一 scope 解码
  const projectCwd = scopeValue.startsWith("project:") ? scopeValue.slice(8) : "";
  const groupId = scopeValue.startsWith("group:") ? scopeValue.slice(6) : "";

  // 依据当前项目作用域解析出 project_id，用于合并项目级 Agent 配置
  const scopedProjectId = useMemo(
    () => projects.find((p) => p.cwd === projectCwd)?.id,
    [projects, projectCwd]
  );

  // 动态 Agent 列表（已过滤禁用项，含本地 + 远程）
  const { data: agentsData } = useAgents({ projectId: scopedProjectId, scopeFilter: true });
  const agentOptions = useMemo(() => {
    const list = agentsData?.agents ?? [];
    if (list.length === 0) return FALLBACK_AGENT_OPTIONS;
    return list.map((a) => ({ label: a.name, value: a.id }));
  }, [agentsData]);

  // 当前所选 Agent 若已被禁用/移除，自动回退到第一个可用项
  useEffect(() => {
    if (agentOptions.length === 0) return;
    if (!agentOptions.some((o) => o.value === agentId)) {
      setAgentId(agentOptions[0].value);
    }
  }, [agentOptions, agentId]);

  // 关闭 CWD 下拉（点击外部）
  // 项目组模式下不需要会话选择，状态以下仅在项目模式下生效
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

  // 当选中项目时加载会话列表；项目组模式清空
  useEffect(() => {
    setSessionId("");
    setSessionError(null);
    if (!projectCwd) {
      setSessionList([]);
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    fetchSessionsForProject(projectCwd)
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
  }, [projectCwd]);

  // 卸载时释放 ObjectURL
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const filteredProjects = useMemo(() => projects, [projects]);
  // 项目组模式下不展示该项
  void filteredProjects;

  const groupedSessions = useMemo(() => {
    const project: SessionItem[] = [];
    const chat: SessionItem[] = [];
    for (const s of sessionList) {
      if (s.type === "chat") chat.push(s);
      else project.push(s);
    }
    return { project, chat };
  }, [sessionList]);

  const selectedSession = useMemo(
    () => sessionList.find((s) => s.id === sessionId) ?? null,
    [sessionList, sessionId]
  );

  const sessionDisabled = !projectCwd;

  const isUploading = attachments.some((a) => a.status === "uploading");

  const handleFiles = async (files: FileList | File[]) => {
    setUploadError(null);
    const incoming = Array.from(files);
    if (!incoming.length) return;

    const remaining = MAX_FILES - attachments.length;
    if (remaining <= 0) {
      setUploadError(`最多上传 ${MAX_FILES} 个文件`);
      return;
    }

    const accepted: File[] = [];
    for (const file of incoming.slice(0, remaining)) {
      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`文件 ${file.name} 超过 20MB 上限`);
        continue;
      }
      accepted.push(file);
    }
    if (incoming.length > remaining) {
      setUploadError(`仅接受前 ${remaining} 个文件，最多 ${MAX_FILES} 个`);
    }
    if (!accepted.length) return;

    const items: AttachmentItem[] = accepted.map((file) => {
      const isImage = file.type.startsWith("image/") || IMAGE_RE.test(file.name);
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      if (previewUrl) previewUrlsRef.current.push(previewUrl);
      return {
        id: genId(),
        name: file.name,
        size: file.size,
        isImage,
        previewUrl,
        status: "uploading",
      };
    });

    setAttachments((prev) => [...prev, ...items]);

    // 逐个上传，便于独立标记错误
    await Promise.all(
      accepted.map(async (file, idx) => {
        const item = items[idx];
        try {
          const res = await uploadTaskAttachments([file]);
          const remote = res.attachments[0];
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === item.id
                ? { ...a, status: "done", remotePath: remote }
                : a
            )
          );
        } catch (err) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === item.id
                ? {
                    ...a,
                    status: "error",
                    error: err instanceof Error ? err.message : "上传失败",
                  }
                : a
            )
          );
        }
      })
    );
  };

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
      e.target.value = "";
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current = previewUrlsRef.current.filter(
          (u) => u !== target.previewUrl
        );
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const pickSession = (id: string) => {
    setSessionId(id);
    setSessionOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (isUploading) return;

    const remotePaths = attachments
      .filter((a) => a.status === "done" && a.remotePath)
      .map((a) => a.remotePath as string);

    const params: CreateTaskParams = {
      prompt: prompt.trim(),
      agent_id: agentId,
      model: model.trim() || undefined,
      session_id: sessionId || undefined,
      attachments: remotePaths,
    };
    if (groupId) {
      params.group_id = groupId;
    } else if (projectCwd) {
      params.cwd = projectCwd;
    }

    try {
      await createMutation.mutateAsync(params);
      // 清理预览 URL
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      previewUrlsRef.current = [];
      setPrompt("");
      setModel("");
      setScopeValue("");
      setSessionId("");
      setAttachments([]);
      setUploadError(null);
      onSuccess?.();
    } catch {
      // mutation 状态会展示错误
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Prompt *</label>
        <textarea
          className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="输入任务指令..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Agent</label>
          <Select
            options={agentOptions}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">模型</label>
          <Input
            placeholder="可选，如 o4-mini"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
      </div>

      {/* 工作目录 / 项目组 - 统一选择器 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">项目 / 项目组</label>
        <select
          value={scopeValue}
          onChange={(e) => setScopeValue(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">默认（后端推断）</option>
          {projects.length > 0 && (
            <optgroup label="项目">
              {projects.map((p) => (
                <option key={p.id} value={`project:${p.cwd}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {groups.length > 0 && (
            <optgroup label="项目组">
              {groups.map((g) => (
                <option key={g.id} value={`group:${g.id}`}>
                  {g.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {projectCwd && (
          <p className="mt-1.5 truncate text-xs text-muted-foreground">工作目录：{projectCwd}</p>
        )}
      </div>

      {/* 会话选择 - Combobox */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          会话
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (可选，默认新建会话)
          </span>
        </label>
        <div className="relative" ref={sessionBoxRef}>
          <button
            type="button"
            disabled={sessionDisabled}
            onClick={() => !sessionDisabled && setSessionOpen((v) => !v)}
            className={
              "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 " +
              (selectedSession ? "text-foreground" : "text-muted-foreground")
            }
          >
            {selectedSession ? (
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={
                    "inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold tracking-wide " +
                    (AGENT_BADGE_CLASS[selectedSession.agent_id] ??
                      "bg-muted text-muted-foreground")
                  }
                >
                  {AGENT_LABEL[selectedSession.agent_id] ??
                    selectedSession.agent_id.slice(0, 2).toUpperCase()}
                </span>
                <span className="truncate">{selectedSession.title || selectedSession.id}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatSessionDate(selectedSession.created_at)}
                </span>
              </span>
            ) : (
              <span>
                {groupId
                  ? "项目组任务不支持选择会话"
                  : sessionDisabled
                    ? "请先选择项目"
                    : sessionLoading
                      ? "加载会话中..."
                      : "新建会话（默认）/ 选择已有会话..."}
              </span>
            )}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ml-2 shrink-0 opacity-60"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {sessionOpen && !sessionDisabled && (
            <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-md">
              {/* 新建会话 */}
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
        {sessionError && !sessionOpen && (
          <p className="mt-1.5 text-xs text-destructive">{sessionError}</p>
        )}
      </div>

      {/* 附件上传 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          附件
          <span className="ml-1 text-xs text-muted-foreground">
            (单文件 ≤ 20MB，最多 {MAX_FILES} 个)
          </span>
        </label>
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors " +
            (dragActive
              ? "border-primary bg-primary/5 text-primary"
              : "border-input bg-background text-muted-foreground hover:border-primary/60 hover:bg-accent/30")
          }
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div>
            <span className="font-medium text-foreground">点击上传</span>
            <span> 或拖拽文件到此区域</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onPickFiles}
          />
        </div>

        {uploadError && (
          <p className="mt-2 text-xs text-destructive">{uploadError}</p>
        )}

        {attachments.length > 0 && (
          <ul className="mt-3 space-y-2">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-md border bg-background p-2"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  {a.isImage && a.previewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={a.previewUrl}
                      alt={a.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatSize(a.size)}
                    {a.status === "uploading" && (
                      <span className="ml-2 text-primary">上传中...</span>
                    )}
                    {a.status === "error" && (
                      <span className="ml-2 text-destructive">
                        {a.error || "上传失败"}
                      </span>
                    )}
                    {a.status === "done" && (
                      <span className="ml-2 text-emerald-600">已上传</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`移除 ${a.name}`}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="submit"
          disabled={createMutation.isPending || !prompt.trim() || isUploading}
        >
          {createMutation.isPending
            ? "创建中..."
            : isUploading
              ? "等待上传完成..."
              : "创建任务"}
        </Button>
      </div>

      {createMutation.isError && (
        <p className="text-sm text-destructive">
          创建失败：{String(createMutation.error)}
        </p>
      )}
    </form>
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
