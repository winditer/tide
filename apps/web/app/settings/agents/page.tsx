"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  toast,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@tide/ui";
import { apiClient, useAuth } from "@tide/core";
import {
  ArrowLeft,
  Bot,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  Server,
  Trash2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentInfo {
  id: string;
  type: "local" | "remote";
  name: string;
  description?: string | null;
  available?: boolean;
  status?: string;
  running_tasks?: number;
  queued_tasks?: number;
  model_override?: string | null;
  timeout_override?: number | null;
  skills?: any[];
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
}

interface AgentConfig {
  id: string;
  workspace_id: string;
  agent_id: string;
  scope: string;
  scope_target?: string | null;
  enabled: number;
  display_name?: string | null;
  description?: string | null;
  model_override?: string | null;
  timeout_override?: number | null;
  config_json?: Record<string, any> | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

type ScopeType = "global" | "project" | "personal";

const SCOPE_LABELS: Record<ScopeType, string> = {
  global: "全局",
  project: "项目",
  personal: "个人",
};

const SCOPE_VARIANT: Record<ScopeType, "default" | "secondary" | "outline"> = {
  global: "default",
  project: "secondary",
  personal: "outline",
};

const PAGE_SIZE = 20;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsAgentsPage() {
  const router = useRouter();
  const { hydrated, user } = useAuth();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  // Scope state
  const [scope, setScope] = useState<ScopeType>("global");
  const [projectTarget, setProjectTarget] = useState<string>("");

  // Dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentInfo | null>(null);
  const [editConfig, setEditConfig] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<AgentInfo | null>(null);
  // 删除意图：reset=重置本地 Agent 的配置覆盖；remote=注销远程 Agent
  const [deleteMode, setDeleteMode] = useState<"reset" | "remote">("reset");

  const isAdmin = user?.role === "admin";

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search.trim());
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  // Fetch projects
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const data = await apiClient.get<{ projects: ProjectOption[] }>(
          "/api/projects?workspace_id=default"
        );
        const list = data?.projects || (Array.isArray(data) ? data : []);
        setProjects(list.map((p: any) => ({ id: p.id, name: p.name })));
      } catch {
        // ignore
      }
    })();
  }, [hydrated]);

  // Fetch agents (raw full list, including disabled ones, for management)
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ agents: AgentInfo[] }>(
        "/api/agents?overrides=false"
      );
      setAgents(data?.agents || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch configs for current scope
  const fetchConfigs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ workspace_id: "default", scope });
      if (scope === "project" && projectTarget) {
        params.set("scope_target", projectTarget);
      }
      if (scope === "personal" && user?.id) {
        params.set("scope_target", user.id);
      }
      const data = await apiClient.get<AgentConfig[]>(`/api/agent-configs?${params}`);
      setConfigs(Array.isArray(data) ? data : []);
    } catch {
      setConfigs([]);
    }
  }, [scope, projectTarget, user?.id]);

  useEffect(() => {
    if (hydrated) {
      fetchAgents();
      fetchConfigs();
    }
  }, [hydrated, fetchAgents, fetchConfigs]);

  // Build config map for current scope
  const configMap = useMemo(() => {
    const map: Record<string, AgentConfig> = {};
    for (const c of configs) {
      map[c.agent_id] = c;
    }
    return map;
  }, [configs]);

  // Merge agents with their config status
  const mergedAgents = useMemo(() => {
    return agents.map((a) => {
      const cfg = configMap[a.id];
      return {
        ...a,
        configEnabled: cfg ? cfg.enabled !== 0 : true,
        config: cfg,
        displayName: cfg?.display_name || a.name,
        displayDescription: cfg?.description || a.description,
        modelOverride: cfg?.model_override || a.model_override,
      };
    });
  }, [agents, configMap]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!debounced) return mergedAgents;
    const q = debounced.toLowerCase();
    return mergedAgents.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        (a.displayDescription || "").toLowerCase().includes(q)
    );
  }, [mergedAgents, debounced]);

  // Check if current scope is editable
  const canEdit = useMemo(() => {
    if (scope === "project" && !projectTarget) return false; // 必须先选择项目
    if (!user) return true; // no auth mode
    if (scope === "global") return isAdmin;
    if (scope === "personal") return true;
    return true; // project scope with a selected project
  }, [user, scope, isAdmin, projectTarget]);

  // 禁用编辑时的提示文案
  const editDisabledReason = useMemo(() => {
    if (scope === "project" && !projectTarget) return "请先选择一个项目";
    if (scope === "global") return "仅管理员可操作全局配置";
    return "无操作权限";
  }, [scope, projectTarget]);

  // Toggle agent enabled/disabled
  const handleToggle = async (agent: AgentInfo, currentCfg: AgentConfig | null) => {
    const newEnabled = currentCfg ? (currentCfg.enabled ? 0 : 1) : 0;

    try {
      if (currentCfg) {
        await apiClient.patch(`/api/agent-configs/${currentCfg.id}/toggle`, {
          enabled: newEnabled,
        });
      } else {
        // Create a new config with enabled=0 (to disable it)
        const scopeTarget =
          scope === "project" ? projectTarget : scope === "personal" ? user?.id : null;
        await apiClient.post("/api/agent-configs", {
          workspace_id: "default",
          agent_id: agent.id,
          scope,
          scope_target: scopeTarget || null,
          enabled: 0,
        });
      }
      toast({
        title: newEnabled ? "已启用" : "已禁用",
        description: agent.name,
      });
      fetchConfigs();
    } catch (e: any) {
      const detail = e?.body?.detail || e?.message || "操作失败";
      toast({ title: "操作失败", description: detail, variant: "destructive" });
    }
  };

  // Open edit dialog
  const openEdit = (agent: AgentInfo) => {
    setEditingAgent(agent);
    setEditConfig(configMap[agent.id] || null);
    setEditDialogOpen(true);
  };

  // Save config
  const handleSave = async (data: {
    display_name: string;
    description: string;
    model_override: string;
    timeout_override: string;
    scope: ScopeType;
    scope_target: string | null;
  }) => {
    setSaving(true);
    try {
      const body: any = {
        workspace_id: "default",
        agent_id: editingAgent!.id,
        scope: data.scope,
        scope_target: data.scope_target || null,
        display_name: data.display_name || null,
        description: data.description || null,
        model_override: data.model_override || null,
        timeout_override: data.timeout_override ? parseInt(data.timeout_override) : null,
      };

      if (editConfig) {
        await apiClient.put(`/api/agent-configs/${editConfig.id}`, body);
      } else {
        body.enabled = 1;
        await apiClient.post("/api/agent-configs", body);
      }
      toast({ title: "已保存", description: editingAgent!.name });
      setEditDialogOpen(false);
      setEditingAgent(null);
      // 切换到保存的作用域，确保用户立即看到结果
      setScope(data.scope);
      setProjectTarget(data.scope === "project" ? data.scope_target || "" : "");
      fetchConfigs();
    } catch (e: any) {
      const detail = e?.body?.detail || e?.message || "保存失败";
      toast({ title: "保存失败", description: detail, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Delete config (reset a local agent's override) or unregister a remote agent
  const handleConfirmDelete = async () => {
    if (!deletingAgent) return;
    try {
      if (deleteMode === "remote") {
        const rawId = deletingAgent.id.replace(/^a2a:/, "");
        await apiClient.del(`/api/remote-agents/${rawId}`);
        // 同时清理可能存在的配置覆盖
        const cfg = configMap[deletingAgent.id];
        if (cfg) {
          try {
            await apiClient.del(`/api/agent-configs/${cfg.id}`);
          } catch {
            // ignore
          }
        }
        toast({ title: "已删除", description: `远程 Agent ${deletingAgent.name} 已注销` });
        setDeletingAgent(null);
        fetchAgents();
        fetchConfigs();
        return;
      }
      // reset
      const cfg = configMap[deletingAgent.id];
      if (!cfg) {
        setDeletingAgent(null);
        return;
      }
      await apiClient.del(`/api/agent-configs/${cfg.id}`);
      toast({ title: "已重置", description: `${deletingAgent.name} 配置已恢复默认` });
      setDeletingAgent(null);
      fetchConfigs();
    } catch (e: any) {
      const detail = e?.body?.detail || e?.message || "操作失败";
      toast({ title: "操作失败", description: detail, variant: "destructive" });
    }
  };

  // Scope selector options
  const scopeOptions = [
    { value: "global", label: "全局" },
    { value: "project", label: "项目" },
    { value: "personal", label: "个人" },
  ];

  const projectOptions = [
    { value: "", label: "选择项目…" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <TooltipProvider>
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
                <Bot className="h-3.5 w-3.5" />
                <span>SETTINGS · AGENTS</span>
              </div>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">Agent 管理</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                管理本地和远程 Agent 的配置、作用域与启用状态
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/settings/remote-agents">
                <Button variant="outline" className="gap-1.5">
                  <Plus className="h-4 w-4" /> 添加远程 Agent
                </Button>
              </Link>
            </div>
          </div>
        </header>

        {/* Scope + Search */}
        <div className="bg-card rounded-xl shadow-card border border-border/50 p-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索 Agent 名称…"
                className="pl-9 rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
              />
            </div>
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeType)}
              className="w-full sm:w-32"
              options={scopeOptions}
            />
            {scope === "project" && (
              <Select
                value={projectTarget}
                onChange={(e) => setProjectTarget(e.target.value)}
                className="w-full sm:w-56"
                options={projectOptions}
              />
            )}
          </div>
        </div>

        {/* Agent Table */}
        <section className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
          {loading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {debounced ? "未找到匹配的 Agent" : "暂无可用 Agent"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      类型
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      名称
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      ID
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      模型
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      状态
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      任务
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((agent) => {
                    const cfg = configMap[agent.id];
                    const isEnabled = cfg ? cfg.enabled !== 0 : true;
                    const hasConfig = !!cfg;

                    return (
                      <tr
                        key={agent.id}
                        className="border-b border-border/30 hover:bg-muted/20 transition-colors"
                      >
                        {/* Type */}
                        <td className="px-4 py-3">
                          <Badge
                            variant={agent.type === "remote" ? "secondary" : "default"}
                            className="gap-1"
                          >
                            {agent.type === "remote" ? (
                              <Server className="h-3 w-3" />
                            ) : (
                              <Bot className="h-3 w-3" />
                            )}
                            {agent.type === "remote" ? "远程" : "本地"}
                          </Badge>
                        </td>
                        {/* Name */}
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {cfg?.display_name || agent.name}
                          </div>
                          {(cfg?.description || agent.description) && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {cfg?.description || agent.description}
                            </div>
                          )}
                        </td>
                        {/* ID */}
                        <td className="px-4 py-3">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {agent.id}
                          </code>
                        </td>
                        {/* Model */}
                        <td className="px-4 py-3 text-muted-foreground">
                          {cfg?.model_override || agent.model_override || "-"}
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          {canEdit ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant={isEnabled ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => handleToggle(agent, cfg || null)}
                                  className="min-w-[60px] text-xs"
                                >
                                  {isEnabled ? "启用" : "禁用"}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isEnabled ? "点击禁用" : "点击启用"}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    variant={isEnabled ? "default" : "outline"}
                                    size="sm"
                                    disabled
                                    className="min-w-[60px] text-xs"
                                  >
                                    {isEnabled ? "启用" : "禁用"}
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {editDisabledReason}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </td>
                        {/* Tasks */}
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {agent.type === "local" ? (
                            <span>
                              运行 {agent.running_tasks || 0} / 队列{" "}
                              {agent.queued_tasks || 0}
                            </span>
                          ) : (
                            <Badge
                              variant={
                                agent.status === "active" ? "default" : "outline"
                              }
                              className="text-[10px]"
                            >
                              {agent.status}
                            </Badge>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canEdit ? (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openEdit(agent)}
                                    >
                                      <PenLine className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>编辑配置</TooltipContent>
                                </Tooltip>
                                {agent.type === "local" && hasConfig && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setDeleteMode("reset");
                                          setDeletingAgent(agent);
                                        }}
                                      >
                                        <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      重置为默认（内置 Agent 不可删除）
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {agent.type === "remote" && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setDeleteMode("remote");
                                          setDeletingAgent(agent);
                                        }}
                                      >
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>删除远程 Agent</TooltipContent>
                                  </Tooltip>
                                )}
                              </>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button variant="ghost" size="sm" disabled>
                                      <PenLine className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {editDisabledReason}
                                </TooltipContent>
                              </Tooltip>
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
        </section>

        {/* Edit Dialog */}
        <EditAgentDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          agent={editingAgent}
          config={editConfig}
          scope={scope}
          scopeTarget={
            scope === "project"
              ? projectTarget
              : scope === "personal"
                ? user?.id || ""
                : ""
          }
          projects={projects}
          userId={user?.id}
          isNew={!editConfig}
          saving={saving}
          onSave={handleSave}
        />

        {/* Delete / Reset Confirm Dialog */}
        <Dialog
          open={!!deletingAgent}
          onOpenChange={(open) => !open && setDeletingAgent(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {deleteMode === "remote" ? "删除远程 Agent" : "重置配置"}
              </DialogTitle>
            </DialogHeader>
            {deleteMode === "remote" ? (
              <p className="text-sm text-muted-foreground">
                确认删除远程 Agent{" "}
                <span className="font-medium text-foreground">
                  {deletingAgent?.name}
                </span>
                ？删除后将从列表中移除，可通过“添加远程 Agent”重新接入。
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                确认重置{" "}
                <span className="font-medium text-foreground">
                  {deletingAgent?.name}
                </span>{" "}
                的自定义配置？重置后将恢复为默认设置（内置 Agent 仍保留在列表中）。
              </p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setDeletingAgent(null)}
              >
                取消
              </Button>
              <Button variant="destructive" onClick={handleConfirmDelete}>
                {deleteMode === "remote" ? "确认删除" : "确认重置"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}

// ─── Edit Agent Dialog ──────────────────────────────────────────────────────

interface EditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentInfo | null;
  config: AgentConfig | null;
  scope: ScopeType;
  scopeTarget: string;
  projects: ProjectOption[];
  userId?: string;
  isNew: boolean;
  saving: boolean;
  onSave: (data: {
    display_name: string;
    description: string;
    model_override: string;
    timeout_override: string;
    scope: ScopeType;
    scope_target: string | null;
  }) => void;
}

function EditAgentDialog({
  open,
  onOpenChange,
  agent,
  config,
  scope,
  scopeTarget,
  projects,
  userId,
  isNew,
  saving,
  onSave,
}: EditAgentDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [modelOverride, setModelOverride] = useState("");
  const [timeoutOverride, setTimeoutOverride] = useState("");
  const [localScope, setLocalScope] = useState<ScopeType>(scope);
  const [localProject, setLocalProject] = useState("");

  useEffect(() => {
    if (open && agent) {
      setDisplayName(config?.display_name || agent.name || "");
      setDescription(config?.description || agent.description || "");
      setModelOverride(config?.model_override || "");
      setTimeoutOverride(config?.timeout_override?.toString() || "");
      const initScope = (config?.scope as ScopeType) || scope;
      setLocalScope(initScope);
      setLocalProject(
        initScope === "project"
          ? config?.scope_target || (scope === "project" ? scopeTarget : "") || ""
          : ""
      );
    }
  }, [open, agent, config, scope, scopeTarget]);

  if (!agent) return null;

  const scopeInvalid = localScope === "project" && !localProject;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (scopeInvalid) return;
    const scope_target =
      localScope === "project"
        ? localProject
        : localScope === "personal"
          ? config?.scope_target || userId || null
          : null;
    onSave({
      display_name: displayName,
      description,
      model_override: modelOverride,
      timeout_override: timeoutOverride,
      scope: localScope,
      scope_target,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            编辑 Agent 配置 — {agent.name}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={SCOPE_VARIANT[localScope]}>{SCOPE_LABELS[localScope]}</Badge>
            <code className="bg-muted px-1.5 py-0.5 rounded">{agent.id}</code>
            <span>·</span>
            <span>{agent.type === "remote" ? "远程 Agent" : "本地 Agent"}</span>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">作用域</label>
            <Select
              value={localScope}
              onChange={(e) => {
                const v = e.target.value as ScopeType;
                setLocalScope(v);
                if (v !== "project") setLocalProject("");
              }}
              options={[
                { value: "global", label: "全局" },
                { value: "project", label: "项目" },
                { value: "personal", label: "个人" },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              选择该配置生效的范围：全局对所有人生效，项目仅对指定项目生效，个人仅对自己生效
            </p>
          </div>

          {localScope === "project" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">项目</label>
              <Select
                value={localProject}
                onChange={(e) => setLocalProject(e.target.value)}
                options={[
                  { value: "", label: "选择项目…" },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              {scopeInvalid && (
                <p className="text-xs text-destructive">请选择一个项目</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">显示名称</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={agent.name}
            />
            <p className="text-xs text-muted-foreground">
              留空则使用默认名称
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">描述</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agent 描述信息…"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">模型覆盖</label>
            <Input
              value={modelOverride}
              onChange={(e) => setModelOverride(e.target.value)}
              placeholder="如 gpt-4o、claude-opus-4-6（留空使用默认）"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">超时（秒）</label>
            <Input
              value={timeoutOverride}
              onChange={(e) => setTimeoutOverride(e.target.value)}
              placeholder="如 7200（留空使用默认）"
              type="number"
              min="1"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={saving || scopeInvalid}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
