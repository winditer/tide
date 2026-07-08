"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
} from "@tide/ui";
import { apiClient, useAuth } from "@tide/core";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SquadMember {
  agent_id: string;
  [key: string]: any;
}

interface ExpertTeam {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  agent_id: string;
  model?: string | null;
  skill_slugs: string[];
  role_prompt?: string | null;
  is_squad?: number;
  member_agents?: SquadMember[];
  leader_strategy?: string;
  enabled: number;
  created_at?: string | null;
  updated_at?: string | null;
}

const LEADER_STRATEGY_OPTIONS = [
  { value: "capability_match", label: "能力匹配" },
  { value: "round_robin", label: "轮询" },
  { value: "random", label: "随机" },
];

interface AgentOption {
  id: string;
  name: string;
  type: "local" | "remote";
}

interface SkillOption {
  id: string;
  slug: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL_OPTIONS = [
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "qwen3.7-max",
  "qwen3.7-plus",
  "ZHIPU/GLM-5.1",
  "MiniMax-M2.5",
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsExpertTeamsPage() {
  const router = useRouter();
  const { hydrated, user } = useAuth();

  const [teams, setTeams] = useState<ExpertTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const [selectedProject, setSelectedProject] = useState<string>("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpertTeam | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExpertTeam | null>(null);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  // Fetch agents (local + remote from unified API)
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const data = await apiClient.get<{ agents: any[] }>("/api/agents");
        const allAgents: AgentOption[] = (data?.agents || []).map((a: any) => ({
          id: a.id,
          name: a.name,
          type: a.type === "remote" ? ("remote" as const) : ("local" as const),
        }));
        setAgents(allAgents);
      } catch {
        // fallback: empty list
      }
    })();
  }, [hydrated]);

  // Fetch skills
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const data = await apiClient.get<SkillOption[]>("/api/skills?workspace_id=default");
        setSkills(Array.isArray(data) ? data.map((s) => ({ id: s.id, slug: s.slug, name: s.name })) : []);
      } catch {
        // ignore
      }
    })();
  }, [hydrated]);

  // Fetch projects
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const data = await apiClient.get<{ projects: ProjectOption[] }>("/api/projects?workspace_id=default");
        const list = data?.projects || (Array.isArray(data) ? data : []);
        setProjects(list.map((p: any) => ({ id: p.id, name: p.name })));
      } catch {
        // ignore
      }
    })();
  }, [hydrated]);

  // Fetch expert teams
  const fetchTeams = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace_id: "default" });
      if (selectedProject) params.set("project_id", selectedProject);
      const data = await apiClient.get<ExpertTeam[]>(`/api/expert-teams?${params}`);
      setTeams(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hydrated) fetchTeams();
  }, [hydrated, selectedProject]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!debounced) return teams;
    const q = debounced.toLowerCase();
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        t.agent_id.toLowerCase().includes(q)
    );
  }, [teams, debounced]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Toggle enabled
  const toggleEnabled = async (team: ExpertTeam) => {
    const newEnabled = team.enabled ? 0 : 1;
    try {
      await apiClient.put<ExpertTeam>(`/api/expert-teams/${team.id}`, { enabled: newEnabled });
      setTeams((prev) =>
        prev.map((t) => (t.id === team.id ? { ...t, enabled: newEnabled } : t))
      );
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await apiClient.del(`/api/expert-teams/${deleting.id}`);
      toast({ title: "已删除", description: deleting.name });
      setDeleting(null);
      fetchTeams();
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  // Save (create/update)
  const handleSave = async (data: {
    name: string;
    description: string;
    agent_id: string;
    model: string;
    skill_slugs: string[];
    role_prompt: string;
    project_id: string | null;
    enabled: number;
    is_squad: number;
    member_agents: SquadMember[];
    leader_strategy: string;
  }) => {
    setSaving(true);
    try {
      const body: any = {
        workspace_id: "default",
        name: data.name,
        description: data.description,
        agent_id: data.agent_id,
        model: data.model || null,
        skill_slugs: data.skill_slugs,
        role_prompt: data.role_prompt,
        project_id: data.project_id || null,
        enabled: data.enabled,
        is_squad: data.is_squad,
        member_agents: data.is_squad ? data.member_agents : [],
        leader_strategy: data.is_squad ? data.leader_strategy : "capability_match",
      };
      if (editing) {
        await apiClient.put<ExpertTeam>(`/api/expert-teams/${editing.id}`, body);
      } else {
        await apiClient.post<ExpertTeam>("/api/expert-teams", body);
      }
      toast({ title: editing ? "已更新" : "已创建", description: data.name });
      setDialogOpen(false);
      setEditing(null);
      fetchTeams();
    } catch (e: any) {
      const detail = e?.body?.detail || e?.message || "保存失败";
      toast({ title: "保存失败", description: detail, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Resolve agent name
  const getAgentName = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name || agentId;
  };

  // Project selector options
  const projectOptions = [
    { value: "", label: "全局（所有项目）" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

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
              <Users className="h-3.5 w-3.5" />
              <span>SETTINGS · EXPERT TEAMS</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">专家团管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              配置专家团，定义 Agent 组合与技能集，提升多 Agent 协作效率
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> 创建专家团
            </Button>
          </div>
        </div>
      </header>

      {/* Search + Project Filter */}
      <div className="bg-card rounded-xl shadow-card border border-border/50 p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索专家团名称 / 描述 / Agent…"
              className="pl-9 rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
            />
          </div>
          <Select
            value={selectedProject}
            onChange={(e) => {
              setSelectedProject(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-56"
            options={projectOptions}
          />
        </div>
      </div>

      {/* Table */}
      <section className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-destructive">加载失败：{error}</div>
        ) : paged.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {debounced || selectedProject ? "未找到匹配的专家团" : "暂无专家团"}
            </p>
            {!debounced && !selectedProject && (
              <Button
                className="mt-5 gap-1.5"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> 创建第一个专家团
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">描述</th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">技能数</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">来源</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {paged.map((team) => (
                  <tr key={team.id} className="hover:bg-muted/40 transition-smooth">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{team.name}</span>
                        {team.is_squad ? (
                          <Badge variant="default" className="bg-indigo-500 hover:bg-indigo-500">
                            小队
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{team.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-muted-foreground line-clamp-1 max-w-[200px]">
                        {team.description || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {team.is_squad ? (
                        <Badge variant="secondary">
                          {(team.member_agents?.length || 0)} 名成员
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{getAgentName(team.agent_id)}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {team.skill_slugs.length}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleEnabled(team)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          team.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                            team.enabled ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={team.project_id ? "default" : "outline"}>
                        {team.project_id
                          ? projects.find((p) => p.id === team.project_id)?.name || "项目级"
                          : "全局"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={!team.project_id && user?.role !== "admin"}
                          title={!team.project_id && user?.role !== "admin" ? "仅管理员可操作全局配置" : "编辑"}
                          onClick={() => {
                            setEditing(team);
                            setDialogOpen(true);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!team.project_id && user?.role !== "admin"}
                          title={!team.project_id && user?.role !== "admin" ? "仅管理员可操作全局配置" : "删除"}
                          onClick={() => setDeleting(team)}
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

        {/* Pagination */}
        {paged.length > 0 && (
          <div className="flex items-center justify-between border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
            <span>
              第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} 条 / 共{" "}
              {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-xs transition-smooth hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> 上一页
              </button>
              <span className="font-mono">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-xs transition-smooth hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
              >
                下一页 <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Create/Edit Dialog */}
      <ExpertTeamDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setEditing(null);
        }}
        team={editing}
        saving={saving}
        onSave={handleSave}
        agents={agents}
        skills={skills}
        projects={projects}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定删除专家团 <strong>{deleting?.name}</strong>？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

// ─── Expert Team Dialog ──────────────────────────────────────────────────────

function ExpertTeamDialog({
  open,
  onOpenChange,
  team,
  saving,
  onSave,
  agents,
  skills,
  projects,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  team: ExpertTeam | null;
  saving: boolean;
  onSave: (data: {
    name: string;
    description: string;
    agent_id: string;
    model: string;
    skill_slugs: string[];
    role_prompt: string;
    project_id: string | null;
    enabled: number;
    is_squad: number;
    member_agents: SquadMember[];
    leader_strategy: string;
  }) => void;
  agents: AgentOption[];
  skills: SkillOption[];
  projects: ProjectOption[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("qoder");
  const [model, setModel] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [rolePrompt, setRolePrompt] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [enabled, setEnabled] = useState(1);
  const [isSquad, setIsSquad] = useState(false);
  const [memberAgents, setMemberAgents] = useState<string[]>([]);
  const [leaderStrategy, setLeaderStrategy] = useState("capability_match");

  useEffect(() => {
    if (open) {
      if (team) {
        setName(team.name);
        setDescription(team.description || "");
        setAgentId(team.agent_id);
        setModel(team.model || "");
        setSelectedSkills(team.skill_slugs || []);
        setSkillSearch("");
        setRolePrompt(team.role_prompt || "");
        setProjectId(team.project_id || "");
        setEnabled(team.enabled);
        setIsSquad(!!team.is_squad);
        setMemberAgents(
          (team.member_agents || [])
            .map((m) => m?.agent_id)
            .filter((id): id is string => !!id)
        );
        setLeaderStrategy(team.leader_strategy || "capability_match");
      } else {
        setName("");
        setDescription("");
        setAgentId("qoder");
        setModel("");
        setSelectedSkills([]);
        setSkillSearch("");
        setRolePrompt("");
        setProjectId("");
        setEnabled(1);
        setIsSquad(false);
        setMemberAgents([]);
        setLeaderStrategy("capability_match");
      }
    }
  }, [open, team]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "请填写专家团名称", variant: "destructive" });
      return;
    }
    if (!isSquad && !agentId) {
      toast({ title: "请选择 Agent", variant: "destructive" });
      return;
    }
    if (isSquad && memberAgents.length === 0) {
      toast({ title: "小队模式需至少选择一个成员 Agent", variant: "destructive" });
      return;
    }
    onSave({
      name,
      description,
      agent_id: isSquad ? memberAgents[0] : agentId,
      model,
      skill_slugs: selectedSkills,
      role_prompt: rolePrompt,
      project_id: projectId || null,
      enabled,
      is_squad: isSquad ? 1 : 0,
      member_agents: memberAgents.map((id) => ({ agent_id: id })),
      leader_strategy: leaderStrategy,
    });
  };

  const toggleMember = (id: string) => {
    setMemberAgents((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const toggleSkill = (slug: string) => {
    setSelectedSkills((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const scopeOptions = [
    { value: "", label: "全局" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const agentOptions = agents.map((a) => ({
    value: a.id,
    label: `${a.name}${a.type === "remote" ? " (远程)" : ""}`,
  }));

  const filteredSkills = useMemo(() => {
    if (!skillSearch.trim()) return skills;
    const q = skillSearch.trim().toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q)
    );
  }, [skills, skillSearch]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{team ? "编辑专家团" : "创建专家团"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">名称 *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="专家团名称" />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">描述</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述此专家团的职责"
            />
          </div>

          {/* Mode Toggle */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">模式</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsSquad(false)}
                className={`rounded-lg border px-3 py-2 text-sm text-left transition-smooth ${
                  !isSquad
                    ? "border-indigo-500 bg-indigo-500/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-foreground/30"
                }`}
              >
                <div className="font-medium">单一 Agent</div>
                <div className="text-xs text-muted-foreground">使用单个 Agent 执行</div>
              </button>
              <button
                type="button"
                onClick={() => setIsSquad(true)}
                className={`rounded-lg border px-3 py-2 text-sm text-left transition-smooth ${
                  isSquad
                    ? "border-indigo-500 bg-indigo-500/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-foreground/30"
                }`}
              >
                <div className="font-medium">小队模式</div>
                <div className="text-xs text-muted-foreground">多 Agent 协作调度</div>
              </button>
            </div>
          </div>

          {/* Agent (single mode) + Scope */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!isSquad && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Agent *</label>
                <Select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  options={agentOptions}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">作用域</label>
              <Select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                options={scopeOptions}
              />
            </div>
          </div>

          {/* Squad fields */}
          {isSquad && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  成员 Agent{" "}
                  <span className="text-muted-foreground font-normal">
                    ({memberAgents.length} 已选)
                  </span>
                </label>
                {memberAgents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {memberAgents.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-600 dark:text-indigo-300"
                      >
                        {agents.find((a) => a.id === id)?.name || id}
                        <button
                          type="button"
                          onClick={() => toggleMember(id)}
                          className="hover:text-destructive"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="max-h-[180px] overflow-y-auto rounded-lg border border-border/50 bg-background p-2 space-y-1">
                  {agents.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">暂无可用 Agent</p>
                  ) : (
                    agents.map((agent) => (
                      <label
                        key={agent.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 cursor-pointer transition-smooth"
                      >
                        <input
                          type="checkbox"
                          checked={memberAgents.includes(agent.id)}
                          onChange={() => toggleMember(agent.id)}
                          className="h-3.5 w-3.5 rounded border-border text-indigo-500 focus:ring-indigo-500"
                        />
                        <span className="text-sm">{agent.name}</span>
                        {agent.type === "remote" && (
                          <span className="text-xs text-muted-foreground">(远程)</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Leader 策略</label>
                <Select
                  value={leaderStrategy}
                  onChange={(e) => setLeaderStrategy(e.target.value)}
                  options={LEADER_STRATEGY_OPTIONS}
                />
                <p className="text-xs text-muted-foreground">
                  决定如何从成员中选择执行者：能力匹配 / 轮询 / 随机
                </p>
              </div>
            </>
          )}

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">模型</label>
            <input
              list="model-options"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="选择或输入模型名称"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <datalist id="model-options">
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">留空则使用 Agent 默认模型，支持手动输入自定义模型</p>
          </div>

          {/* Skills selection */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              技能选择{" "}
              <span className="text-muted-foreground font-normal">
                ({selectedSkills.length} 已选)
              </span>
            </label>
            <Input
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
              placeholder="搜索技能名称或 slug…"
              className="rounded-lg border-border/50"
            />
            <div className="max-h-[180px] overflow-y-auto rounded-lg border border-border/50 bg-background p-2 space-y-1">
              {skills.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">暂无可用技能</p>
              ) : filteredSkills.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">无匹配技能</p>
              ) : (
                filteredSkills.map((skill) => (
                  <label
                    key={skill.slug}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 cursor-pointer transition-smooth"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkills.includes(skill.slug)}
                      onChange={() => toggleSkill(skill.slug)}
                      className="h-3.5 w-3.5 rounded border-border text-indigo-500 focus:ring-indigo-500"
                    />
                    <span className="text-sm">{skill.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{skill.slug}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Role Prompt */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">角色提示词</label>
            <textarea
              value={rolePrompt}
              onChange={(e) => setRolePrompt(e.target.value)}
              placeholder="定义此专家团的角色定位与行为准则…"
              rows={5}
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[100px]"
            />
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <span className="text-sm font-medium">启用状态</span>
            <button
              type="button"
              onClick={() => setEnabled(enabled ? 0 : 1)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                  enabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "保存中…" : team ? "保存修改" : "创建专家团"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
