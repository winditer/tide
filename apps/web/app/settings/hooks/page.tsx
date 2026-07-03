"use client";

import { useEffect, useState } from "react";
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
import { apiClient, useAuth } from "@tide/core";
import { ProjectScopeSelector } from "@tide/views/components/project-scope-selector";
import {
  ArrowLeft,
  PenLine,
  Plus,
  ShieldCheck,
  Trash2,
  Webhook,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Hook {
  id: string;
  workspace_id: string;
  name: string;
  event: string;
  action_type: string;
  action_config: Record<string, unknown>;
  conditions?: Record<string, unknown> | null;
  priority: number;
  enabled: boolean;
  created_at?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const EVENT_OPTIONS = [
  { value: "", label: "全部事件" },
  { value: "task.started", label: "task.started" },
  { value: "task.completed", label: "task.completed" },
  { value: "task.failed", label: "task.failed" },
  { value: "workflow.node.pre", label: "workflow.node.pre" },
  { value: "workflow.node.post", label: "workflow.node.post" },
  { value: "workflow.run.completed", label: "workflow.run.completed" },
  { value: "approval.resolved", label: "approval.resolved" },
];

const EVENT_OPTIONS_NO_ALL = EVENT_OPTIONS.filter((e) => e.value !== "");

const ACTION_TYPE_OPTIONS = [
  { value: "script", label: "script" },
  { value: "webhook", label: "webhook" },
  { value: "notification", label: "notification" },
  { value: "skill", label: "skill" },
];

const ACTION_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  script: "default",
  webhook: "secondary",
  notification: "outline",
  skill: "default",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function eventBadgeClass(event: string): string {
  if (event.startsWith("task.")) return "bg-blue-500/15 text-blue-600 border-blue-500/30";
  if (event.startsWith("workflow.")) return "bg-purple-500/15 text-purple-600 border-purple-500/30";
  return "bg-muted text-muted-foreground";
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function HooksPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventFilter, setEventFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Hook | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const fetchHooks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ workspace_id: "default" });
      if (eventFilter) params.set("event", eventFilter);
      if (projectId) params.set("project_id", projectId);
      const data = await apiClient.get<Hook[] | { hooks?: Hook[] }>(`/api/hooks?${params}`);
      setHooks(Array.isArray(data) ? data : data.hooks ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventFilter, projectId]);

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个 Hook 吗？")) return;
    try {
      await apiClient.del(`/api/hooks/${id}?workspace_id=default`);
      toast({ title: "已删除" });
      fetchHooks();
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  const handleSave = async (data: Omit<Hook, "id" | "created_at" | "enabled">) => {
    try {
      const body = { ...data };
      if (editing) {
        await apiClient.put<Hook>(`/api/hooks/${editing.id}`, body);
      } else {
        await apiClient.post<Hook>("/api/hooks", body);
      }
      toast({ title: editing ? "已更新" : "已创建" });
      setDialogOpen(false);
      setEditing(null);
      fetchHooks();
    } catch (err: any) {
      const detail = err?.body?.detail ?? "请检查输入";
      toast({ title: "保存失败", description: detail, variant: "destructive" });
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {/* Header */}
      <header className="space-y-3">
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-smooth"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回设置
        </button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Webhook className="h-3.5 w-3.5" />
              <span>SETTINGS · HOOKS</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">事件钩子</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              在任务和工作流生命周期中自动触发操作
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="gap-1.5 shrink-0"
          >
            <Plus className="h-4 w-4" /> 新建 Hook
          </Button>
        </div>
      </header>

      {/* Filter */}
      <div className="bg-card rounded-xl shadow-card border border-border/50 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">事件筛选</label>
            <Select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              options={EVENT_OPTIONS}
              className="max-w-xs rounded-lg border-border/50"
            />
          </div>
          <ProjectScopeSelector
            value={projectId}
            onChange={(v) => setProjectId(v)}
            className="w-full sm:w-56"
          />
        </div>
      </div>

      {/* Table */}
      <section className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : hooks.length === 0 ? (
          <div className="py-16 text-center">
            <Webhook className="mx-auto h-8 w-8 text-muted-foreground/50" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-muted-foreground">暂无事件钩子</p>
            <Button
              className="mt-5 gap-1.5"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> 创建第一个 Hook
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">事件</th>
                  <th className="px-4 py-3 font-medium">动作类型</th>
                  <th className="px-4 py-3 font-medium">优先级</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {hooks.map((hook) => (
                  <tr key={hook.id} className="hover:bg-muted/40 transition-smooth">
                    <td className="px-4 py-3 font-medium">{hook.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={eventBadgeClass(hook.event)}>
                        {hook.event}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ACTION_BADGE_VARIANT[hook.action_type] ?? "outline"}>
                        {hook.action_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{hook.priority}</td>
                    <td className="px-4 py-3">
                      {hook.enabled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          启用
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                          禁用
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={!(hook as any).project_id && user?.role !== "admin"}
                          title={!(hook as any).project_id && user?.role !== "admin" ? "仅管理员可操作全局配置" : "编辑"}
                          onClick={() => {
                            setEditing(hook);
                            setDialogOpen(true);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!(hook as any).project_id && user?.role !== "admin"}
                          title={!(hook as any).project_id && user?.role !== "admin" ? "仅管理员可操作全局配置" : "删除"}
                          onClick={() => handleDelete(hook.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create/Edit Dialog */}
      <HookDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setEditing(null);
        }}
        hook={editing}
        onSave={handleSave}
      />
    </main>
  );
}

// ── Dialog ───────────────────────────────────────────────────────────────────

function HookDialog({
  open,
  onOpenChange,
  hook,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hook: Hook | null;
  onSave: (data: Omit<Hook, "id" | "created_at" | "enabled">) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [event, setEvent] = useState("task.completed");
  const [actionType, setActionType] = useState("script");
  const [scriptPath, setScriptPath] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookMethod, setWebhookMethod] = useState("POST");
  const [channel, setChannel] = useState("");
  const [skillSlug, setSkillSlug] = useState("");
  const [conditions, setConditions] = useState("");
  const [priority, setPriority] = useState(0);
  const [dialogProjectId, setDialogProjectId] = useState<string>("");
  const [projects, setProjects] = useState<{ id: string; name: string; cwd?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch projects for scope selector
  useEffect(() => {
    apiClient
      .get<{ projects?: { id: string; name: string; cwd?: string }[] }>("/api/projects")
      .then((data) => {
        const list = data?.projects ?? [];
        setProjects(Array.isArray(list) ? list : []);
      })
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (open) {
      if (hook) {
        setName(hook.name);
        setEvent(hook.event);
        setActionType(hook.action_type);
        const cfg = hook.action_config ?? {};
        setScriptPath((cfg.script_path as string) ?? "");
        setWebhookUrl((cfg.url as string) ?? "");
        setWebhookMethod((cfg.method as string) ?? "POST");
        setChannel((cfg.channel as string) ?? "");
        setSkillSlug((cfg.skill_slug as string) ?? "");
        setConditions(hook.conditions ? JSON.stringify(hook.conditions, null, 2) : "");
        setPriority(hook.priority ?? 0);
        setDialogProjectId((hook as any).project_id ?? "");
      } else {
        setName("");
        setEvent("task.completed");
        setActionType("script");
        setScriptPath("");
        setWebhookUrl("");
        setWebhookMethod("POST");
        setChannel("");
        setSkillSlug("");
        setConditions("");
        setPriority(0);
        setDialogProjectId("");
      }
      setError(null);
    }
  }, [open, hook]);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("名称必填");
    if (!event) return setError("事件必填");

    let action_config: Record<string, unknown> = {};
    if (actionType === "script") {
      if (!scriptPath.trim()) return setError("脚本路径必填");
      action_config = { script_path: scriptPath.trim() };
    } else if (actionType === "webhook") {
      if (!webhookUrl.trim()) return setError("Webhook URL 必填");
      action_config = { url: webhookUrl.trim(), method: webhookMethod };
    } else if (actionType === "notification") {
      if (!channel.trim()) return setError("通知渠道必填");
      action_config = { channel: channel.trim() };
    } else if (actionType === "skill") {
      if (!skillSlug.trim()) return setError("Skill Slug 必填");
      action_config = { skill_slug: skillSlug.trim() };
    }

    let parsedConditions: Record<string, unknown> | null = null;
    if (conditions.trim()) {
      try {
        parsedConditions = JSON.parse(conditions.trim());
      } catch {
        return setError("Conditions JSON 格式无效");
      }
    }

    setSaving(true);
    await onSave({
      workspace_id: "default",
      name: name.trim(),
      event,
      action_type: actionType,
      action_config,
      conditions: parsedConditions,
      priority,
      ...(dialogProjectId ? { project_id: dialogProjectId } : {}),
    } as any);
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background/95 backdrop-blur-xl max-w-lg">
        <DialogHeader>
          <DialogTitle>{hook ? "编辑 Hook" : "新建 Hook"}</DialogTitle>
          <DialogDescription>
            {hook ? "修改事件钩子配置" : "创建一个新的事件钩子来自动触发操作"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="名称" required>
            <Input
              autoFocus
              placeholder="Hook 名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border-border/50"
            />
          </Field>

          <Field label="作用域">
            <select
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              value={dialogProjectId}
              onChange={(e) => setDialogProjectId(e.target.value)}
            >
              <option value="">全局</option>
              {projects.map((p) => (
                <option key={p.id || p.cwd} value={p.id || p.cwd}>
                  {p.name || p.cwd}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="事件" required>
              <Select
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                options={EVENT_OPTIONS_NO_ALL}
                className="rounded-lg border-border/50"
              />
            </Field>
            <Field label="动作类型" required>
              <Select
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                options={ACTION_TYPE_OPTIONS}
                className="rounded-lg border-border/50"
              />
            </Field>
          </div>

          {/* Dynamic action config fields */}
          {actionType === "script" && (
            <Field label="脚本路径" required>
              <Input
                placeholder="/path/to/script.sh"
                value={scriptPath}
                onChange={(e) => setScriptPath(e.target.value)}
                className="rounded-lg border-border/50 font-mono text-xs"
              />
            </Field>
          )}
          {actionType === "webhook" && (
            <div className="space-y-3">
              <Field label="Webhook URL" required>
                <Input
                  placeholder="https://example.com/webhook"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="rounded-lg border-border/50 font-mono text-xs"
                />
              </Field>
              <Field label="HTTP 方法">
                <Select
                  value={webhookMethod}
                  onChange={(e) => setWebhookMethod(e.target.value)}
                  options={[
                    { value: "GET", label: "GET" },
                    { value: "POST", label: "POST" },
                    { value: "PUT", label: "PUT" },
                  ]}
                  className="rounded-lg border-border/50"
                />
              </Field>
            </div>
          )}
          {actionType === "notification" && (
            <Field label="通知渠道" required>
              <Input
                placeholder="channel name"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="rounded-lg border-border/50"
              />
            </Field>
          )}
          {actionType === "skill" && (
            <Field label="Skill Slug" required>
              <Input
                placeholder="skill-slug"
                value={skillSlug}
                onChange={(e) => setSkillSlug(e.target.value)}
                className="rounded-lg border-border/50 font-mono text-xs"
              />
            </Field>
          )}

          <Field label="Conditions（JSON，可选）">
            <textarea
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder='{"status": "success"}'
              rows={3}
              className="flex w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </Field>

          <Field label="优先级">
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="rounded-lg border-border/50 w-24"
            />
          </Field>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving} onClick={submit}>
            {saving ? "保存中…" : hook ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Field Helper ─────────────────────────────────────────────────────────────

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
      <span className="mb-1.5 flex items-center text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
