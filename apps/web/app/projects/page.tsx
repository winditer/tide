"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardContent, Input } from "@tide/ui";
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
  useArchiveProject,
  useUnarchiveProject,
  type ProjectInfo,
} from "@tide/core";

type DialogMode = "new" | "register";

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
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, isError } = useProjects({ show_archived: showArchived });
  const createMutation = useCreateProject();
  const deleteMutation = useDeleteProject();
  const archiveMutation = useArchiveProject();
  const unarchiveMutation = useUnarchiveProject();

  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

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

  return (
    <main className="mx-auto max-w-7xl px-2 py-2">
      {/* Editorial hero */}
      <header className="mb-10 border-b-2 border-zinc-900 pb-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[11px] tracking-[0.4em] text-zinc-500">
              WORKSPACE · CATALOG
            </div>
            <h1 className="mt-2 font-serif text-5xl font-bold leading-none tracking-tight text-zinc-900">
              Projects<span className="text-emerald-600">.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm text-zinc-600">
              所有被关注的目录，按最近活跃排序。点击进入查看 conversations、tasks 与统计。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] tracking-widest text-zinc-500">
              {total} TOTAL · {registeredCount} REGISTERED
              {showArchived && archivedCount > 0 ? ` · ${archivedCount} ARCHIVED` : ""}
            </span>
            <Button
              variant="outline"
              className={
                showArchived
                  ? "border-2 border-zinc-900 bg-zinc-900 text-white shadow-[3px_3px_0_0_rgba(24,24,27,1)] hover:bg-zinc-800"
                  : "border-2 border-zinc-900 bg-white shadow-[3px_3px_0_0_rgba(24,24,27,1)] hover:bg-zinc-100"
              }
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "◉ 隐藏归档" : "○ 显示归档"}
            </Button>
            <Button
              variant="outline"
              className="border-2 border-zinc-900 bg-white shadow-[3px_3px_0_0_rgba(24,24,27,1)] hover:bg-zinc-100"
              onClick={() => setDialog("register")}
            >
              ＋ 添加已有
            </Button>
            <Button
              className="border-2 border-zinc-900 bg-emerald-600 text-white shadow-[3px_3px_0_0_rgba(24,24,27,1)] hover:bg-emerald-700"
              onClick={() => setDialog("new")}
            >
              ＋ 新建项目
            </Button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="py-16 text-center font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING…
        </div>
      ) : isError ? (
        <div className="py-16 text-center font-mono text-xs text-rose-600">
          ✕ FAILED TO LOAD
        </div>
      ) : projects.length === 0 ? (
        <EmptyState onAdd={() => setDialog("register")} onCreate={() => setDialog("new")} />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
                if (!confirm(`从已知项目列表中移除 “${project.name}” ？\n（不会删除文件）`)) {
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
  return (
    <Card
      className={
        project.archived
          ? "group relative border-2 border-zinc-400 bg-zinc-50 opacity-80 shadow-[6px_6px_0_0_rgba(24,24,27,0.4)] transition-transform hover:-translate-y-0.5"
          : "group relative border-2 border-zinc-900 shadow-[6px_6px_0_0_rgba(24,24,27,0.92)] transition-transform hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_rgba(24,24,27,0.92)]"
      }
    >
      <CardContent className="p-0">
        <Link href={`/projects/${project.id}`} className="block p-5">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
                №{String(index + 1).padStart(2, "0")} ·{" "}
                {project.registered ? "REGISTERED" : "DISCOVERED"}
                {project.archived ? " · ARCHIVED" : ""}
              </div>
              <h3 className="mt-1 truncate font-serif text-xl font-semibold text-zinc-900">
                {project.name}
              </h3>
            </div>
            {project.archived ? (
              <Badge
                variant="secondary"
                className="border-2 border-zinc-400 bg-white text-zinc-500"
              >
                已归档
              </Badge>
            ) : (
              <Badge
                variant={project.status === "active" ? "default" : "secondary"}
                className={
                  project.status === "active"
                    ? "border-2 border-zinc-900 bg-emerald-600 text-white"
                    : "border-2 border-zinc-900 bg-white text-zinc-700"
                }
              >
                {project.status === "active" ? "活跃" : "空闲"}
              </Badge>
            )}
          </div>

          <p className="mb-4 truncate rounded-sm bg-zinc-100 px-2 py-1 font-mono text-[11px] text-zinc-600">
            {project.cwd}
          </p>

          <div className="grid grid-cols-4 gap-2 border-t border-zinc-200 pt-3 text-center">
            <Stat label="TASKS" value={project.task_count} />
            <Stat label="SESSIONS" value={project.session_count ?? 0} />
            {/* CHATS 列表不精确计算（性能问题），仅项目详情页显示准确值；这里为空时占位为 "—"。 */}
            <Stat label="CHATS" value={project.chat_count ?? null} />
            <Stat label="AGENTS" value={(project.agents ?? []).length} />
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
            <span className="font-mono">{formatTime(project.last_active)}</span>
            <span className="flex flex-wrap gap-1">
              {(project.agents ?? []).slice(0, 4).map((a) => (
                <span
                  key={a}
                  className="rounded-sm border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                >
                  {a}
                </span>
              ))}
            </span>
          </div>

          {project.running_tasks > 0 && (
            <p className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-emerald-700">
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
            className="absolute right-2 top-2 rounded-sm border border-zinc-300 bg-white/90 px-2 py-0.5 font-mono text-[10px] tracking-wider text-zinc-600 opacity-0 transition-opacity hover:border-rose-500 hover:text-rose-600 group-hover:opacity-100 disabled:opacity-50"
          >
            {isRemoving ? "…" : "REMOVE"}
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
            "rounded-sm border border-zinc-300 bg-white/90 px-2 py-0.5 font-mono text-[10px] tracking-wider text-zinc-600 opacity-0 transition-opacity hover:border-amber-500 hover:text-amber-600 group-hover:opacity-100 disabled:opacity-50"
          }
        >
          {isArchiving ? "…" : project.archived ? "UNARCHIVE" : "ARCHIVE"}
        </button>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="font-serif text-lg font-semibold text-zinc-900">
        {value === null || value === undefined ? "—" : value}
      </div>
      <div className="font-mono text-[10px] tracking-widest text-zinc-500">{label}</div>
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
    <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-300 py-20 text-center">
      <div className="font-mono text-[11px] tracking-[0.3em] text-zinc-400">
        EMPTY · NO PROJECTS YET
      </div>
      <p className="mt-3 font-serif text-2xl text-zinc-700">
        关注一个目录，开始编排你的 Agent 工作
      </p>
      <div className="mt-6 flex gap-2">
        <Button variant="outline" className="border-2 border-zinc-900" onClick={onAdd}>
          ＋ 添加已有
        </Button>
        <Button className="border-2 border-zinc-900 bg-emerald-600 text-white" onClick={onCreate}>
          ＋ 新建项目
        </Button>
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
  onSubmit: (input: { cwd: string; name?: string; tags?: string[] }) => Promise<void>;
  isPending: boolean;
}) {
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const title = mode === "new" ? "新建项目" : "添加已有项目";
  const subtitle =
    mode === "new"
      ? "告诉系统关注一个目录（不会执行 git init）"
      : "把已有的目录注册到工作台";

  const submit = async () => {
    setError(null);
    const trimmed = cwd.trim();
    if (!trimmed) {
      setError("路径不能为空");
      return;
    }
    try {
      await onSubmit({
        cwd: trimmed,
        name: name.trim() || undefined,
        tags: tagsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg border-2 border-zinc-900 bg-white shadow-[12px_12px_0_0_rgba(24,24,27,0.92)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-5 py-3 text-white">
          <span className="font-mono text-[11px] tracking-[0.3em]">
            {mode === "new" ? "NEW · PROJECT" : "REGISTER · PROJECT"}
          </span>
          <button
            onClick={onClose}
            className="font-mono text-sm text-zinc-300 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="space-y-5 p-6">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-zinc-900">{title}</h2>
            <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
          </div>

          <Field label="项目路径 (绝对路径)" required>
            <Input
              autoFocus
              placeholder="/Users/your/path/to/project"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="border-2 border-zinc-900 font-mono text-sm"
            />
          </Field>

          <Field label="项目名（可选）">
            <Input
              placeholder="默认使用目录名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-2 border-zinc-900"
            />
          </Field>

          <Field label="标签（可选，逗号分隔）">
            <Input
              placeholder="frontend, infra, demo"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="border-2 border-zinc-900 font-mono text-sm"
            />
          </Field>

          {error && (
            <div className="border border-rose-500 bg-rose-50 px-3 py-2 font-mono text-xs text-rose-700">
              ✕ {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
            <Button variant="outline" className="border-2 border-zinc-900" onClick={onClose}>
              取消
            </Button>
            <Button
              disabled={isPending}
              className="border-2 border-zinc-900 bg-emerald-600 text-white shadow-[3px_3px_0_0_rgba(24,24,27,1)] hover:bg-emerald-700"
              onClick={submit}
            >
              {isPending ? "保存中…" : mode === "new" ? "创建" : "添加"}
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
      <span className="mb-1.5 block font-mono text-[11px] tracking-widest text-zinc-600">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </span>
      {children}
    </label>
  );
}
