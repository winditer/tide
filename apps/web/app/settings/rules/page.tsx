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
import { ProjectScopeSelector } from "@tide/views/components/project-scope-selector";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Plus,
  Scale,
  Search,
  Trash2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Rule {
  id: string;
  workspace_id: string;
  name: string;
  scope?: string | null;
  scope_value?: string | null;
  project_id?: string | null;
  content: string;
  priority: number;
  enabled: number;
  source?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCOPE_OPTIONS = [
  { value: "", label: "全部作用域" },
  { value: "global", label: "全局 (global)" },
  { value: "language", label: "语言 (language)" },
  { value: "project", label: "项目 (project)" },
];

const SCOPE_LABELS: Record<string, string> = {
  global: "全局",
  language: "语言",
  project: "项目",
};

const SCOPE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  global: "default",
  language: "secondary",
  project: "outline",
};

const LANGUAGE_OPTIONS = [
  { value: "python", label: "Python" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "rust", label: "Rust" },
  { value: "c", label: "C/C++" },
  { value: "shell", label: "Shell" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── Page ────────────────────────────────────────────────────────────────────

interface ProjectOption {
  id: string;
  name: string;
  cwd?: string;
}

export default function SettingsRulesPage() {
  const router = useRouter();
  const { hydrated, user } = useAuth();

  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  // Fetch projects
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const data = await apiClient.get<{ projects: ProjectOption[] }>("/api/projects?workspace_id=default");
        const list = data?.projects || (Array.isArray(data) ? data : []);
        setProjects(list.map((p: any) => ({ id: p.id || p.cwd, name: p.name || p.cwd, cwd: p.cwd })));
      } catch {
        // ignore
      }
    })();
  }, [hydrated]);

  // Fetch rules
  const fetchRules = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace_id: "default" });
      if (scope) params.set("scope", scope);
      if (projectId) params.set("project_id", projectId);
      const data = await apiClient.get<Rule[]>(`/api/rules?${params}`);
      setRules(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hydrated) fetchRules();
  }, [hydrated, scope, projectId]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!debounced) return rules;
    const q = debounced.toLowerCase();
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.scope_value || "").toLowerCase().includes(q) ||
        (r.content || "").toLowerCase().includes(q)
    );
  }, [rules, debounced]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Toggle enabled
  const toggleEnabled = async (rule: Rule) => {
    const newEnabled = rule.enabled ? 0 : 1;
    try {
      await apiClient.put<Rule>(`/api/rules/${rule.id}?workspace_id=default`, { enabled: newEnabled });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: newEnabled } : r))
      );
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await apiClient.del(`/api/rules/${deleting.id}?workspace_id=default`);
      toast({ title: "已删除", description: deleting.name });
      setDeleting(null);
      fetchRules();
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  // Save (create/update)
  const handleSave = async (data: {
    name: string;
    scope: string;
    scope_value: string;
    project_id: string;
    content: string;
    priority: number;
  }) => {
    setSaving(true);
    try {
      const body: any = {
        workspace_id: "default",
        name: data.name,
        scope: data.scope || "global",
        scope_value: data.scope_value || null,
        project_id: data.project_id || projectId || null,
        content: data.content,
        priority: data.priority,
      };
      if (editing) {
        await apiClient.put<Rule>(`/api/rules/${editing.id}?workspace_id=default`, body);
      } else {
        await apiClient.post<Rule>("/api/rules", body);
      }
      if (!editing) {
        toast({ title: "已创建", description: data.name });
      }
      setDialogOpen(false);
      setEditing(null);
      fetchRules();
    } catch (e: any) {
      const detail = e?.body?.detail || e?.message || "保存失败";
      toast({ title: "保存失败", description: detail, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

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
              <Scale className="h-3.5 w-3.5" />
              <span>SETTINGS · RULES</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">规则引擎</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              管理 Agent 执行时的强制约束规则，确保代码规范一致性
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
              <Plus className="h-4 w-4" /> 新建规则
            </Button>
          </div>
        </div>
      </header>

      {/* Search + Filter */}
      <div className="bg-card rounded-xl shadow-card border border-border/50 p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索规则名称 / 作用域值 / 内容…"
              className="pl-9 rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
            />
          </div>
          <Select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-48"
            options={SCOPE_OPTIONS}
          />
          <ProjectScopeSelector
            value={projectId}
            onChange={(v) => { setProjectId(v); setPage(1); }}
            className="w-full sm:w-56"
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
              {debounced || scope ? "未找到匹配的规则" : "暂无规则"}
            </p>
            {!debounced && !scope && (
              <Button
                className="mt-5 gap-1.5"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> 创建第一条规则
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">作用域</th>
                  <th className="px-4 py-3 font-medium">优先级</th>
                  <th className="px-4 py-3 font-medium">来源</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {paged.map((rule) => (
                  <tr key={rule.id} className="hover:bg-muted/40 transition-smooth">
                    <td className="px-4 py-3">
                      <div className="font-medium">{rule.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={SCOPE_VARIANT[rule.scope || "global"] ?? "default"}>
                          {SCOPE_LABELS[rule.scope || "global"] ?? rule.scope}
                        </Badge>
                        {rule.scope_value && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {rule.scope_value}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-muted text-xs font-mono font-medium">
                        {rule.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{rule.source || "custom"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleEnabled(rule)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          rule.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                            rule.enabled ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={!rule.project_id && user?.role !== "admin"}
                          title={!rule.project_id && user?.role !== "admin" ? "仅管理员可操作全局配置" : "编辑"}
                          onClick={() => {
                            setEditing(rule);
                            setDialogOpen(true);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!rule.project_id && user?.role !== "admin"}
                          title={!rule.project_id && user?.role !== "admin" ? "仅管理员可操作全局配置" : "删除"}
                          onClick={() => setDeleting(rule)}
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
      <RuleDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setEditing(null);
        }}
        rule={editing}
        saving={saving}
        onSave={handleSave}
        projects={projects}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定删除规则 <strong>{deleting?.name}</strong>？此操作不可撤销。
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

// ─── Rule Dialog ─────────────────────────────────────────────────────────────

function RuleDialog({
  open,
  onOpenChange,
  rule,
  saving,
  onSave,
  projects,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: Rule | null;
  saving: boolean;
  onSave: (data: {
    name: string;
    scope: string;
    scope_value: string;
    project_id: string;
    content: string;
    priority: number;
  }) => void;
  projects: ProjectOption[];
}) {
  const [name, setName] = useState("");
  const [ruleScope, setRuleScope] = useState("global");
  const [scopeValue, setScopeValue] = useState("");
  const [projectId, setProjectId] = useState("");
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState(0);

  useEffect(() => {
    if (open) {
      if (rule) {
        setName(rule.name);
        setRuleScope(rule.scope || "global");
        setScopeValue(rule.scope_value || "");
        setProjectId(rule.project_id || "");
        setContent(rule.content);
        setPriority(rule.priority);
      } else {
        setName("");
        setRuleScope("global");
        setScopeValue("");
        setProjectId("");
        setContent("");
        setPriority(0);
      }
    }
  }, [open, rule]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) {
      toast({ title: "请填写必填字段", variant: "destructive" });
      return;
    }
    onSave({
      name,
      scope: ruleScope,
      scope_value: scopeValue,
      project_id: projectId,
      content,
      priority,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "编辑规则" : "新建规则"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">名称 *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="规则名称" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">作用域</label>
              <Select
                value={ruleScope}
                onChange={(e) => setRuleScope(e.target.value)}
                options={[
                  { value: "global", label: "全局 (global)" },
                  { value: "language", label: "语言 (language)" },
                  { value: "project", label: "项目 (project)" },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">优先级</label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
          </div>

          {ruleScope === "language" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">语言</label>
              <Select
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                options={[
                  { value: "", label: "选择语言…" },
                  ...LANGUAGE_OPTIONS,
                ]}
              />
            </div>
          )}

          {ruleScope === "project" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">项目</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">选择项目</option>
                {projects.map((p) => (
                  <option key={p.id || p.cwd} value={p.id || p.cwd}>
                    {p.name || p.cwd}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">规则内容 (Markdown) *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="在此输入规则内容（支持 Markdown）…"
              rows={14}
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[200px]"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "保存中…" : rule ? "保存修改" : "创建规则"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
