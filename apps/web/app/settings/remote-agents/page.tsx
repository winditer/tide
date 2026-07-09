"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Input,
  toast,
} from "@tide/ui";
import { apiClient, ApiError, useAuth } from "@tide/core";
import {
  ArrowLeft,
  FolderOpen,
  Globe,
  Network,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
  Wifi,
} from "lucide-react";
import {
  AgentFormDialog,
  ConfirmDeleteDialog,
  type AgentFormValue,
} from "./agent-dialogs";
import { RemoteAgentGuide } from "@tide/views/remote-agents/RemoteAgentGuide";

// ── Types ────────────────────────────────────────────────────────────────

export interface RemoteAgentSkill {
  id?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface RemoteAgent {
  id: string;
  name: string;
  description: string | null;
  agent_card_url: string | null;
  endpoint_url: string | null;
  auth_type: string | null;
  auth_credentials: string | null;
  auth_header_name: string | null;
  approval_policy: string | null;
  approval_required?: number | boolean | null;
  timeout_ms: number | null;
  max_retries: number | null;
  status: string | null;
  last_health_check: string | null;
  last_error: string | null;
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
  skills: RemoteAgentSkill[];
  scope?: string | null;
  scope_target?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ListResponse {
  items: RemoteAgent[];
  total: number;
}

interface DiscoverResponse {
  url: string;
  agent_card: Record<string, unknown> | null;
  name: string | null;
  description: string | null;
  endpoint_url: string | null;
  skills: RemoteAgentSkill[];
  capabilities: { streaming?: boolean; pushNotifications?: boolean };
}

interface TestResponse {
  ok: boolean;
  id: string;
  url: string;
  status_code: number;
  error: string | null;
  checked_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function getApiErrorMessage(err: unknown): string {
  if (!err) return "未知错误";
  if (err instanceof ApiError) {
    const body = err.body as { detail?: unknown } | null | undefined;
    if (body && typeof body === "object" && typeof body.detail === "string") {
      return body.detail;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function scopeLabel(
  scope: string | null | undefined,
  scopeTarget: string | null | undefined,
): string {
  const v = (scope ?? "global").toLowerCase();
  if (v === "project") return scopeTarget ? `项目 · ${scopeTarget}` : "项目";
  if (v === "personal") return "个人";
  return "全局";
}

function statusMeta(status: string | null | undefined): {
  label: string;
  dot: string;
  text: string;
  bg: string;
  border: string;
} {
  const v = (status ?? "").toLowerCase();
  if (v === "active") {
    return {
      label: "活跃",
      dot: "bg-emerald-500",
      text: "text-emerald-600",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
    };
  }
  if (v === "unreachable") {
    return {
      label: "不可达",
      dot: "bg-amber-500",
      text: "text-amber-600",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
    };
  }
  if (v === "inactive") {
    return {
      label: "已停用",
      dot: "bg-rose-500",
      text: "text-rose-600",
      bg: "bg-rose-500/10",
      border: "border-rose-500/30",
    };
  }
  return {
    label: status || "未知",
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border/50",
  };
}

// ── API helpers ──────────────────────────────────────────────────────────

const API = {
  list: () => apiClient.get<ListResponse>("/api/remote-agents"),
  create: (body: unknown) => apiClient.post<RemoteAgent>("/api/remote-agents", body),
  update: (id: string, body: unknown) =>
    apiClient.put<RemoteAgent>(`/api/remote-agents/${encodeURIComponent(id)}`, body),
  remove: (id: string) =>
    apiClient.del<{ ok: boolean; id: string }>(
      `/api/remote-agents/${encodeURIComponent(id)}`,
    ),
  test: (id: string) =>
    apiClient.post<TestResponse>(`/api/remote-agents/${encodeURIComponent(id)}/test`),
  refresh: (id: string) =>
    apiClient.post<RemoteAgent>(
      `/api/remote-agents/${encodeURIComponent(id)}/refresh`,
    ),
  discover: (url: string) =>
    apiClient.post<DiscoverResponse>("/api/remote-agents/discover", { url }),
  validateAuth: (body: {
    endpoint_url?: string;
    agent_card_url?: string;
    auth_type?: string;
    auth_credentials?: string;
    auth_header_name?: string;
  }) =>
    apiClient.post<{ valid: boolean; error: string | null }>(
      "/api/remote-agents/validate-auth",
      body,
    ),
};

// ── Page ─────────────────────────────────────────────────────────────────

export default function RemoteAgentsPage() {
  const router = useRouter();
  const { user, hydrated } = useAuth();

  const [agents, setAgents] = useState<RemoteAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RemoteAgent | null>(null);
  const [deleting, setDeleting] = useState<RemoteAgent | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, "test" | "refresh" | null>>({});

  const setBusy = (id: string, op: "test" | "refresh" | null) =>
    setBusyIds((prev) => ({ ...prev, [id]: op }));

  const reload = useCallback(async () => {
    setError(null);
    try {
      const data = await API.list();
      setAgents(data.items ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const hay = [
        a.name,
        a.id,
        a.endpoint_url,
        a.agent_card_url,
        a.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [agents, search]);

  const handleTest = async (agent: RemoteAgent) => {
    setBusy(agent.id, "test");
    try {
      const result = await API.test(agent.id);
      if (result.ok) {
        toast({
          title: "连通性正常",
          description: `${agent.name} · HTTP ${result.status_code}`,
        });
      } else {
        toast({
          title: "连通失败",
          description: result.error ?? `HTTP ${result.status_code}`,
          variant: "destructive",
        });
      }
      await reload();
    } catch (err) {
      toast({
        title: "测试失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setBusy(agent.id, null);
    }
  };

  const handleRefresh = async (agent: RemoteAgent) => {
    setBusy(agent.id, "refresh");
    try {
      await API.refresh(agent.id);
      toast({ title: "已刷新 Agent Card", description: agent.name });
      await reload();
    } catch (err) {
      toast({
        title: "刷新失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setBusy(agent.id, null);
    }
  };

  const handleCreate = async (input: AgentFormValue) => {
    // 个人作用域时回填 scope_target 为当前用户 ID，与后端自动回填一致，
    // 避免 scope_target 为空导致 Agent 在任务/聊天选择列表中不可见。
    const scopeTarget =
      input.scope === "personal" && !input.scope_target && user?.id
        ? user.id
        : input.scope_target;
    await API.create({
      name: input.name,
      description: input.description || undefined,
      agent_card_url: input.agent_card_url || undefined,
      endpoint_url: input.endpoint_url || undefined,
      auth_type: input.auth_type,
      auth_credentials: input.auth_credentials || undefined,
      auth_header_name: input.auth_header_name || undefined,
      approval_policy: input.approval_policy,
      timeout_ms: input.timeout_ms,
      max_retries: input.max_retries,
      scope: input.scope,
      scope_target: scopeTarget,
    });
    toast({ title: "已注册远程 Agent", description: input.name });
    setCreateOpen(false);
    await reload();
  };

  const handleUpdate = async (agent: RemoteAgent, input: AgentFormValue) => {
    const scopeTarget =
      input.scope === "personal" && !input.scope_target && user?.id
        ? user.id
        : input.scope_target;
    await API.update(agent.id, {
      name: input.name,
      description: input.description || null,
      agent_card_url: input.agent_card_url || null,
      endpoint_url: input.endpoint_url || null,
      auth_type: input.auth_type,
      auth_credentials: input.auth_credentials || null,
      auth_header_name: input.auth_header_name || null,
      approval_policy: input.approval_policy,
      timeout_ms: input.timeout_ms,
      max_retries: input.max_retries,
      scope: input.scope,
      scope_target: scopeTarget,
    });
    setEditing(null);
    await reload();
  };

  const handleDelete = async (agent: RemoteAgent) => {
    try {
      await API.remove(agent.id);
      toast({ title: "已删除", description: agent.name });
      setDeleting(null);
      await reload();
    } catch (err) {
      toast({
        title: "删除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  // 未登录用户跳转到登录页；所有已登录用户均可访问本页面
  // （普通用户仅能看到自己创建的 Agent，管理员可看到全部，由后端过滤）
  useEffect(() => {
    if (hydrated && !user) {
      router.replace("/auth/login");
    }
  }, [hydrated, user, router]);

  if (hydrated && !user) {
    return (
      <main className="mx-auto max-w-3xl px-2 py-12">
        <div className="bg-card rounded-xl shadow-card border border-border/50 p-8 text-center">
          <ShieldAlert
            className="mx-auto h-10 w-10 text-muted-foreground"
            strokeWidth={1.5}
          />
          <h2 className="mt-3 text-lg font-semibold">请先登录</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            访问远程 Agent 管理需要登录账号。
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => router.push("/auth/login")}
          >
            前往登录
          </Button>
        </div>
      </main>
    );
  }

  const total = agents.length;
  const activeCount = agents.filter(
    (a) => (a.status ?? "").toLowerCase() === "active",
  ).length;

  return (
    <main className="mx-auto max-w-7xl px-2 py-2 space-y-6">
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
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>ADMIN · REMOTE AGENTS</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
              远程 Agents
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {total} 个已注册 · 活跃 {activeCount} · 通过 A2A 协议接入外部 Agent
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RemoteAgentGuide />
            <Button
              variant="outline"
              onClick={() => void reload()}
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" /> 刷新
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> 注册 Agent
            </Button>
          </div>
        </div>
      </header>

      {/* Search bar */}
      <div className="bg-card rounded-xl shadow-card border border-border/50 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索名称 / 端点 URL / 描述…"
            className="pl-9 rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Table */}
      <section className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-destructive">
            加载失败：{error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Network
              className="mx-auto h-8 w-8 text-muted-foreground/60"
              strokeWidth={1.5}
            />
            <p className="mt-3 text-sm text-muted-foreground">
              {search.trim() ? "未找到匹配的 Agent" : "尚未注册任何远程 Agent"}
            </p>
            {!search.trim() && (
              <Button
                className="mt-5 gap-1.5"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-4 w-4" /> 注册第一个 Agent
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">端点 URL</th>
                  <th className="px-4 py-3 font-medium">作用域</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">技能</th>
                  <th className="px-4 py-3 font-medium">最后检查</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((agent) => {
                  const meta = statusMeta(agent.status);
                  const busy = busyIds[agent.id];
                  return (
                    <tr
                      key={agent.id}
                      className="hover:bg-muted/40 transition-smooth"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 text-indigo-500">
                            <Network className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              {(() => {
                                const s = (agent.scope || "global").toLowerCase();
                                if (s === "project")
                                  return (
                                    <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                                  );
                                if (s === "personal")
                                  return (
                                    <User className="h-3.5 w-3.5 flex-shrink-0 text-purple-500" />
                                  );
                                return (
                                  <Globe className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                                );
                              })()}
                              <div className="font-medium truncate">
                                {agent.name}
                              </div>
                            </div>
                            <div className="text-[11px] font-mono text-muted-foreground truncate">
                              {agent.id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[280px]">
                        <div
                          className="font-mono text-xs text-muted-foreground truncate"
                          title={agent.endpoint_url ?? ""}
                        >
                          {agent.endpoint_url || "—"}
                        </div>
                        {agent.last_error && (
                          <div
                            className="mt-1 text-[11px] text-rose-600 truncate"
                            title={agent.last_error}
                          >
                            {agent.last_error}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md border border-border/50 bg-muted/40 px-2 py-0.5 text-xs">
                          {scopeLabel(agent.scope, agent.scope_target)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.bg} ${meta.border} ${meta.text}`}
                        >
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`}
                          />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-mono">
                          {agent.skills?.length ?? 0}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatTime(agent.last_health_check)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={busy === "test"}
                            onClick={() => void handleTest(agent)}
                            title="测试连通性"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-emerald-500/10 hover:text-emerald-600 disabled:opacity-40"
                          >
                            {busy === "test" ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Wifi className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={busy === "refresh"}
                            onClick={() => void handleRefresh(agent)}
                            title="刷新 Agent Card"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-indigo-500/10 hover:text-indigo-500 disabled:opacity-40"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${
                                busy === "refresh" ? "animate-spin" : ""
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(agent)}
                            title="编辑"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
                          >
                            <PenLine className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleting(agent)}
                            title="删除"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create dialog */}
      <AgentFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={async (value) => {
          try {
            await handleCreate(value);
          } catch (err) {
            toast({
              title: "注册失败",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
            throw err;
          }
        }}
        discover={async (url) => API.discover(url)}
        validateAuth={async (body) => API.validateAuth(body)}
      />

      {/* Edit dialog */}
      <AgentFormDialog
        mode="edit"
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
        initial={editing}
        onSubmit={async (value) => {
          if (!editing) return;
          try {
            await handleUpdate(editing, value);
          } catch (err) {
            toast({
              title: "保存失败",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
            throw err;
          }
        }}
        discover={async (url) => API.discover(url)}
        validateAuth={async (body) => API.validateAuth(body)}
      />

      {/* Delete dialog */}
      <ConfirmDeleteDialog
        agent={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await handleDelete(deleting);
        }}
      />
    </main>
  );
}
