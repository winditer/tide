"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
  FolderOpen,
  Globe,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  Server,
  Trash2,
  User,
} from "lucide-react";
import { RemoteAgentGuide } from "@tide/views/remote-agents/RemoteAgentGuide";
import { ProjectMultiScopeSelector } from "@tide/views";
import { AgentFormDialog } from "../remote-agents/agent-dialogs";

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
  // 远程 Agent 在 remote_agents 表中自带的作用域（注册时确定），
  // 用作列表作用域图标的兜底来源。
  scope?: string | null;
  scope_target?: string | null;
  created_by?: string | null;
  // 后端 JOIN users 后回传的创建人显示名（display_name/username），缺失时回退 created_by。
  created_by_name?: string | null;
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
  created_by_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface GroupOption {
  id: string;
  name: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

type ScopeType = "" | "global" | "project" | "personal";

const SCOPE_LABELS: Record<ScopeType, string> = {
  "": "全部",
  global: "全局",
  project: "项目",
  personal: "个人",
};

const SCOPE_VARIANT: Record<ScopeType, "default" | "secondary" | "outline"> = {
  "": "default",
  global: "default",
  project: "secondary",
  personal: "outline",
};

const PAGE_SIZE = 20;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsAgentsPage() {
  const router = useRouter();
  const { hydrated, user } = useAuth();
  const queryClient = useQueryClient();

  // Agent 启用/禁用/配置变更后，让消费端（浮动聊天、任务、对话等）的
  // useAgents 缓存立即失效并重新拉取，避免下拉列表仍能选到已禁用的 Agent。
  const invalidateAgents = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["agents"] });
  }, [queryClient]);

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  // 跨所有作用域的配置，仅用于列表图标显示 Agent 的真实作用域
  const [allConfigs, setAllConfigs] = useState<AgentConfig[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  // Scope filter state（与专家团筛选栏一致：单一 Select，全部/全局/个人 平铺 + 项目组/项目 分组）
  const [scopeFilter, setScopeFilter] = useState<string>("");
  // 从统一的 scopeFilter 派生 scope 与 projectTarget，供查询、过滤、弹窗等下游逻辑复用
  const scope: ScopeType = useMemo(() => {
    if (scopeFilter === "global") return "global";
    if (scopeFilter === "personal") return "personal";
    if (scopeFilter === "") return "";
    return "project"; // 项目 id 或 group:<id>
  }, [scopeFilter]);
  const projectTarget = useMemo(
    () => (scope === "project" ? scopeFilter : ""),
    [scope, scopeFilter]
  );

  // Dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentInfo | null>(null);
  const [editConfig, setEditConfig] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<AgentInfo | null>(null);
  // 删除意图：reset=重置本地 Agent 的配置覆盖；remote=注销远程 Agent
  const [deleteMode, setDeleteMode] = useState<"reset" | "remote">("reset");
  // 注册远程 Agent 弹窗
  const [registerOpen, setRegisterOpen] = useState(false);

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

  // Fetch project groups
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const data = await apiClient.get<{ groups: GroupOption[] }>(
          "/api/project-groups?workspace_id=default"
        );
        const list = data?.groups || (Array.isArray(data) ? data : []);
        setGroups(list.map((g: any) => ({ id: g.id, name: g.name })));
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
      const params = new URLSearchParams({ workspace_id: "default" });
      if (scope) {
        params.set("scope", scope);
      }
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

  // Fetch configs across all scopes (used only to render the true scope icon per agent)
  const fetchAllConfigs = useCallback(async () => {
    try {
      const data = await apiClient.get<AgentConfig[]>(
        "/api/agent-configs?workspace_id=default"
      );
      setAllConfigs(Array.isArray(data) ? data : []);
    } catch {
      setAllConfigs([]);
    }
  }, []);

  useEffect(() => {
    if (hydrated) {
      fetchAgents();
      fetchConfigs();
      fetchAllConfigs();
    }
  }, [hydrated, fetchAgents, fetchConfigs, fetchAllConfigs]);

  // Build config map for current scope。
  // 同一 Agent 在当前筛选下可能命中多条配置（如“全部作用域”时），
  // 按 personal > project > global 取最具体的一条，保证编辑弹窗初始作用域
  // 与列表图标来源确定；同时过滤掉其他用户的个人配置。
  const configMap = useMemo(() => {
    const order: Record<string, number> = { personal: 3, project: 2, global: 1 };
    const map: Record<string, AgentConfig> = {};
    for (const c of configs) {
      const s = (c.scope || "global").toLowerCase();
      if (
        s === "personal" &&
        user?.id &&
        c.scope_target &&
        c.scope_target !== user.id
      ) {
        continue; // 跳过其他用户的个人配置
      }
      const existing = map[c.agent_id];
      const es = existing ? (existing.scope || "global").toLowerCase() : "";
      if (!existing || (order[s] || 0) > (order[es] || 0)) {
        map[c.agent_id] = c;
      }
    }
    return map;
  }, [configs, user?.id]);

  // 每个 Agent 的真实作用域（跨所有 scope），用于列表图标显示。
  // 同一 Agent 存在多条配置时按 personal > project > global 取最具体的一条；
  // personal 配置仅统计属于当前用户的。
  const agentScopeMap = useMemo(() => {
    const order: Record<string, number> = { personal: 3, project: 2, global: 1 };
    const map: Record<string, ScopeType> = {};
    for (const c of allConfigs) {
      const s = (c.scope || "global").toLowerCase() as ScopeType;
      if (
        s === "personal" &&
        user?.id &&
        c.scope_target &&
        c.scope_target !== user.id
      ) {
        continue; // 跳过其他用户的个人配置
      }
      const existing = map[c.agent_id];
      if (!existing || (order[s] || 0) > (order[existing] || 0)) {
        map[c.agent_id] = s;
      }
    }
    return map;
  }, [allConfigs, user?.id]);

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

  // Filter by scope + search
  const filtered = useMemo(() => {
    let list = mergedAgents;

    // 作用域筛选
    if (scope === "global") {
      // 仅显示真实作用域为全局的 Agent（含无任何配置覆盖的默认全局）；
      // 已显式配置为项目/个人作用域的 Agent 不应出现在全局列表。
      list = list.filter((a) => (agentScopeMap[a.id] || "global") === "global");
    } else if (scope === "project") {
      list = list.filter(
        (a) =>
          !!a.config &&
          a.config.scope === "project" &&
          (!projectTarget || a.config.scope_target === projectTarget)
      );
    } else if (scope === "personal") {
      list = list.filter((a) => agentScopeMap[a.id] === "personal");
    }
    // scope === "" 时展示全部，不过滤

    if (debounced) {
      const q = debounced.toLowerCase();
      list = list.filter(
        (a) =>
          a.id.toLowerCase().includes(q) ||
          a.displayName.toLowerCase().includes(q) ||
          (a.displayDescription || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [mergedAgents, debounced, scope, projectTarget, agentScopeMap]);

  // 判断当前用户是否可编辑某个 agent
  const canEditAgent = useCallback(
    (agent: AgentInfo) => {
      if (!user) return true; // no auth mode
      if (user.role === "viewer") return false;
      if (isAdmin) return true;
      // 创建者可编辑自己创建的 agent
      const cfg = configMap[agent.id];
      const createdBy = cfg?.created_by || (agent as any).created_by;
      return createdBy === user.id;
    },
    [user, isAdmin, configMap]
  );

  // 全局操作按钮（如“注册 Agent”）是否可用
  const canEdit = useMemo(() => {
    if (!user) return true;
    if (user.role === "viewer") return false;
    return true; // admin 和 member 都能注册
  }, [user]);

  // 禁用编辑时的提示文案
  const editDisabledReason = useMemo(() => {
    if (user?.role === "viewer") return "查看者无法编辑";
    return "仅管理员或创建者可操作";
  }, [user]);

  // Toggle agent enabled/disabled
  const handleToggle = async (agent: AgentInfo, currentCfg: AgentConfig | null) => {
    const newEnabled = currentCfg ? (currentCfg.enabled ? 0 : 1) : 0;

    try {
      if (currentCfg) {
        await apiClient.patch(`/api/agent-configs/${currentCfg.id}/toggle`, {
          enabled: newEnabled,
        });
      } else {
        // Create a new config with enabled=0 (to disable it)。
        // 作用域来源优先级：当前筛选器 scope → 该 Agent 的真实作用域 → personal。
        // 「全部作用域」筛选时 scope 为空字符串，此时回退到 Agent 自身作用域，
        // 最终兜底为 personal（而非 global），避免非管理员误触发
        // “仅管理员可管理全局配置”权限错误。
        const effectiveScope: Exclude<ScopeType, ""> =
          scope || agentScopeMap[agent.id] || "personal";
        const scopeTarget =
          effectiveScope === "project"
            ? projectTarget
            : effectiveScope === "personal"
              ? user?.id
              : null;
        await apiClient.post("/api/agent-configs", {
          workspace_id: "default",
          agent_id: agent.id,
          scope: effectiveScope,
          scope_target: scopeTarget || null,
          enabled: 0,
        });
      }
      toast({
        title: newEnabled ? "已启用" : "已禁用",
        description: agent.name,
      });
      fetchConfigs();
      fetchAllConfigs();
      invalidateAgents();
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
    scope_targets?: string[];
  }) => {
    setSaving(true);
    try {
      const agentId = editingAgent!.id;
      const uid = user?.id || null;
      // 该 agent 现有的全部配置（个人作用域仅取当前用户的），
      // 用于精确判定应 PUT（更新）还是 POST（创建），以及切换作用域后清理旧配置。
      const ownConfigs = allConfigs.filter(
        (c) =>
          c.agent_id === agentId &&
          !(c.scope === "personal" && c.scope_target && c.scope_target !== uid)
      );

      const common = {
        display_name: data.display_name || null,
        description: data.description || null,
        model_override: data.model_override || null,
        timeout_override: data.timeout_override
          ? parseInt(data.timeout_override)
          : null,
      };

      if (
        data.scope === "project" &&
        data.scope_targets &&
        data.scope_targets.length > 0
      ) {
        // 批量模式：batch 端点负责项目作用域的创建/删除/更新（按 scope_targets 差集处理）
        await apiClient.post("/api/agent-configs/batch", {
          workspace_id: "default",
          agent_id: agentId,
          scope: "project",
          scope_targets: data.scope_targets,
          ...common,
        });
        // 切换到项目作用域后，清理所有非项目作用域的旧配置（含 global/personal 残留）
        const stale = ownConfigs.filter((c) => c.scope !== "project");
        for (const c of stale) {
          try {
            await apiClient.del(`/api/agent-configs/${c.id}`);
          } catch {
            // ignore
          }
        }
      } else {
        // 单目标模式（global / personal）：采用「先 upsert 新作用域配置 → 再删除其余全部旧配置」
        // 的替换语义，既保证作用域切换真正生效，又能清理历史遗留的同作用域重复配置。
        const scopeTarget = data.scope_target || null;
        // 目标作用域已有的配置（可能因历史数据存在多条重复）
        const matching = ownConfigs.filter(
          (c) =>
            c.scope === data.scope && (c.scope_target || null) === scopeTarget
        );
        const body: any = {
          workspace_id: "default",
          agent_id: agentId,
          scope: data.scope,
          scope_target: scopeTarget,
          ...common,
        };
        // 保留下来的目标配置 id：更新时为被更新那条，新建时为新记录，删除时据此跳过。
        let keepId: string | null = null;
        if (matching.length > 0) {
          // 已存在目标作用域配置：更新第一条，其余重复项后续删除
          await apiClient.put(`/api/agent-configs/${matching[0].id}`, body);
          keepId = matching[0].id;
        } else {
          // 目标作用域下尚无配置：创建新配置（默认启用）
          body.enabled = 1;
          const created = await apiClient.post<AgentConfig>(
            "/api/agent-configs",
            body
          );
          keepId = created?.id || null;
        }
        // 删除除保留项之外的所有旧配置（跨作用域残留 + 同作用域重复项）
        for (const c of ownConfigs) {
          if (c.id === keepId) continue;
          try {
            await apiClient.del(`/api/agent-configs/${c.id}`);
          } catch {
            // ignore
          }
        }
      }
      toast({ title: "已保存", description: editingAgent!.name });
      setEditDialogOpen(false);
      setEditingAgent(null);
      fetchConfigs();
      fetchAllConfigs();
      invalidateAgents();
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
        fetchAllConfigs();
        invalidateAgents();
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
      fetchAllConfigs();
      invalidateAgents();
    } catch (e: any) {
      const detail = e?.body?.detail || e?.message || "操作失败";
      toast({ title: "操作失败", description: detail, variant: "destructive" });
    }
  };

  // 筛选栏作用域选项（与专家团一致）：全部 / 全局 / 个人（平铺）+ 项目组 / 项目（optgroup 分区）。
  // 选中项目时 value 为项目 id，选中项目组时 value 形如 group:<group_id>，二者均作为 project 作用域的目标。
  const scopeFilterOptions = [
    { value: "", label: "全部作用域" },
    { value: "global", label: "全局" },
    { value: "personal", label: "个人（我的）" },
  ];
  const scopeFilterGroups = [
    ...(groups.length > 0
      ? [
          {
            label: "项目组",
            options: groups.map((g) => ({ value: `group:${g.id}`, label: g.name })),
          },
        ]
      : []),
    {
      label: "项目",
      options: projects.map((p) => ({ value: p.id, label: p.name })),
    },
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
              <RemoteAgentGuide />
              <Button
                variant="outline"
                onClick={() => void fetchAgents()}
                className="gap-1.5"
              >
                <RotateCcw className="h-4 w-4" /> 刷新
              </Button>
              <Button onClick={() => setRegisterOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> 注册 Agent
              </Button>
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
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              className="w-full sm:w-56"
              options={scopeFilterOptions}
              groups={scopeFilterGroups}
            />
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
                        <td className="px-4 py-3 whitespace-nowrap">
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
                        <td className="px-4 py-3 max-w-[200px]">
                          <div className="flex items-center gap-2">
                            {(() => {
                              // 作用域图标优先级（从高到低）：
                              // 1. 当前作用域的 config；
                              // 2. 该 Agent 跨作用域配置中最具体的一条（personal > project > global）；
                              // 3. 远程 Agent 在 remote_agents 表中自带的作用域；
                              // 均无则视为“未显式配置”，显示灰色图标。
                              const realScope = (
                                cfg?.scope ||
                                agentScopeMap[agent.id] ||
                                agent.scope ||
                                ""
                              ).toLowerCase();
                              if (realScope === "project")
                                return (
                                  <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                                );
                              if (realScope === "personal")
                                return (
                                  <User className="h-3.5 w-3.5 flex-shrink-0 text-purple-500" />
                                );
                              if (realScope === "global")
                                return (
                                  <Globe className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                                );
                              // 无任何配置覆盖：灰色图标表示使用默认，而非显示为全局
                              return (
                                <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
                              );
                            })()}
                            <div
                              className="font-medium truncate"
                              title={cfg?.display_name || agent.name}
                            >
                              {cfg?.display_name || agent.name}
                            </div>
                          </div>
                          {(cfg?.description || agent.description) && (
                            <div
                              className="text-xs text-muted-foreground mt-0.5 truncate"
                              title={cfg?.description || agent.description || undefined}
                            >
                              {cfg?.description || agent.description}
                            </div>
                          )}
                        </td>
                        {/* ID */}
                        <td className="px-4 py-3 max-w-[160px]">
                          <code
                            className="text-xs bg-muted px-1.5 py-0.5 rounded inline-block max-w-full truncate align-middle"
                            title={agent.id}
                          >
                            {agent.id}
                          </code>
                        </td>
                        {/* Model */}
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {cfg?.model_override || agent.model_override || "-"}
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          {canEditAgent(agent) ? (
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
                            {canEditAgent(agent) ? (
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
          groups={groups}
          allConfigs={allConfigs}
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
                ？删除后将从列表中移除，可通过“注册 Agent”重新接入。
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

        {/* Register Remote Agent Dialog */}
        <AgentFormDialog
          mode="create"
          open={registerOpen}
          onOpenChange={setRegisterOpen}
          onSubmit={async (value) => {
            await apiClient.post("/api/remote-agents", {
              name: value.name,
              description: value.description || undefined,
              agent_card_url: value.agent_card_url || undefined,
              endpoint_url: value.endpoint_url || undefined,
              auth_type: value.auth_type,
              auth_credentials: value.auth_credentials || undefined,
              auth_header_name: value.auth_header_name || undefined,
              approval_policy: value.approval_policy,
              timeout_ms: value.timeout_ms,
              max_retries: value.max_retries,
              scope: value.scope,
              scope_target: value.scope_target,
            });
            toast({ title: "已注册远程 Agent", description: value.name });
            setRegisterOpen(false);
            void fetchAgents();
            void fetchConfigs();
            void fetchAllConfigs();
          }}
          discover={async (url) =>
            apiClient.post<{
              url: string;
              name: string | null;
              description: string | null;
              endpoint_url: string | null;
              skills: any[];
              capabilities: { streaming?: boolean; pushNotifications?: boolean };
            }>("/api/remote-agents/discover", { url })
          }
        />
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
  groups: GroupOption[];
  allConfigs: AgentConfig[];
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
    scope_targets?: string[];
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
  groups,
  allConfigs,
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
  const [localTargets, setLocalTargets] = useState<string[]>([]);

  useEffect(() => {
    if (open && agent) {
      // 名称独立于作用域：预填当前配置的 display_name，未自定义时回退到 agent 原始名称。
      // 切换作用域时该字段值保持不变（不在作用域变更处重置），
      // 保存时所有作用域配置行写入相同的 display_name，保证同一 Agent 名称一致。
      setDisplayName(config?.display_name || agent.name);
      setDescription(config?.description || "");
      setModelOverride(config?.model_override || "");
      setTimeoutOverride(config?.timeout_override?.toString() || "");
      const initScope = (config?.scope as ScopeType) || "global";
      setLocalScope(initScope);
      // 聚合该 agent 所有 scope="project" 的 config 作为初始多选目标
      const projectConfigs = allConfigs.filter(
        (c) => c.agent_id === agent.id && c.scope === "project"
      );
      const targets = projectConfigs
        .map((c) => c.scope_target)
        .filter(Boolean) as string[];
      setLocalTargets(targets);
    }
  }, [open, agent, config, allConfigs]);

  if (!agent) return null;

  const scopeInvalid = localScope === "project" && localTargets.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (scopeInvalid) return;
    if (localScope === "project") {
      onSave({
        display_name: displayName,
        description,
        model_override: modelOverride,
        timeout_override: timeoutOverride,
        scope: localScope,
        scope_target: null,
        scope_targets: localTargets,
      });
      return;
    }
    const scope_target =
      localScope === "personal"
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
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "新建 Agent 配置" : "编辑 Agent 配置"} — {agent.name}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 overflow-hidden text-xs text-muted-foreground">
            <Badge variant={SCOPE_VARIANT[localScope]} className="flex-shrink-0">
              {SCOPE_LABELS[localScope]}
            </Badge>
            <code className="max-w-[220px] truncate whitespace-nowrap rounded bg-muted px-1.5 py-0.5">
              {agent.id}
            </code>
            <span className="flex-shrink-0">·</span>
            <span className="flex-shrink-0">
              {agent.type === "remote" ? "远程 Agent" : "本地 Agent"}
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">作用域</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "global", title: "全局", desc: "对所有人生效" },
                  { key: "project", title: "项目", desc: "指定项目 / 项目组" },
                  { key: "personal", title: "个人", desc: "仅对自己生效" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    setLocalScope(opt.key);
                    if (opt.key !== "project") setLocalTargets([]);
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm text-left transition-smooth ${
                    localScope === opt.key
                      ? "border-indigo-500 bg-indigo-500/10 text-foreground"
                      : "border-border/50 text-muted-foreground hover:border-foreground/30"
                  }`}
                >
                  <div className="font-medium">{opt.title}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </button>
              ))}
            </div>
            {localScope === "personal" && (
              <p className="text-xs text-muted-foreground">
                个人作用域：仅创建者本人可见与使用
              </p>
            )}
          </div>

          {localScope === "project" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">目标项目/项目组（多选）</label>
              <ProjectMultiScopeSelector
                value={localTargets}
                onChange={setLocalTargets}
                showGlobalHint={false}
              />
              {localTargets.length === 0 && (
                <p className="text-xs text-destructive">请至少选择一个项目或项目组</p>
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
              该名称对所有作用域生效，修改后所有作用域配置将使用同一名称
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">描述</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={agent.description || "Agent 描述信息…"}
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

          {/* 创建人与 Agent ID（只读） */}
          <div className="border-t border-border/30 pt-3 mt-2 space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">创建人:</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                {config?.created_by_name ||
                  config?.created_by ||
                  (agent as any).created_by_name ||
                  (agent as any).created_by ||
                  "系统"}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">Agent ID:</span>
              <code className="max-w-[280px] truncate rounded bg-muted px-1.5 py-0.5 font-mono">
                {agent.id}
              </code>
            </div>
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
