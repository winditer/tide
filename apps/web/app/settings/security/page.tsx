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
import { apiClient, useWs } from "@tide/core";
import { ProjectScopeSelector } from "@tide/views/components/project-scope-selector";
import {
  ArrowLeft,
  PenLine,
  Plus,
  ScanLine,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface SecurityRule {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  name: string;
  category: string;
  severity: string;
  pattern: string;
  description?: string;
  remediation?: string;
  enabled: boolean;
  created_at?: string;
}

interface ProjectItem {
  id?: string;
  cwd?: string;
  name?: string;
}

interface SecurityFinding {
  id: string;
  rule_id: string;
  task_id?: string;
  severity: string;
  category: string;
  snippet: string;
  location?: string;
  status: string;
  created_at?: string;
}

interface ScanFinding {
  rule_id: string;
  category: string;
  severity: string;
  snippet: string;
  location: string | null;
  description: string;
  remediation: string;
}

interface FindingSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "secret_detection", label: "secret_detection" },
  { value: "code_injection", label: "code_injection" },
  { value: "path_traversal", label: "path_traversal" },
  { value: "dangerous_command", label: "dangerous_command" },
  { value: "weak_crypto", label: "weak_crypto" },
];

const SEVERITY_OPTIONS = [
  { value: "critical", label: "critical" },
  { value: "high", label: "high" },
  { value: "medium", label: "medium" },
  { value: "low", label: "low" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "全部" },
  { value: "open", label: "open" },
  { value: "dismissed", label: "dismissed" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "bg-red-500/15 text-red-600 border-red-500/30";
    case "high":
      return "bg-orange-500/15 text-orange-600 border-orange-500/30";
    case "medium":
      return "bg-yellow-500/15 text-yellow-700 border-yellow-500/30";
    case "low":
      return "bg-gray-500/15 text-gray-600 border-gray-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"rules" | "findings">("rules");
  const [scanOpen, setScanOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>SETTINGS · SECURITY</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">安全审查</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              自动扫描 Agent 输出中的安全风险
            </p>
          </div>
          <Button onClick={() => setScanOpen(true)} className="gap-1.5 shrink-0">
            <ScanLine className="h-4 w-4" /> 扫描
          </Button>
        </div>
      </header>

      {/* Project Scope Selector */}
      <div className="bg-card rounded-xl shadow-card border border-border/50 p-3">
        <div className="flex items-center gap-3">
          <ProjectScopeSelector
            value={projectId}
            onChange={(v) => setProjectId(v)}
            className="w-full sm:w-56"
          />
        </div>
      </div>

      {/* Tab Switch */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab("rules")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-smooth ${
            tab === "rules"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          安全规则
        </button>
        <button
          type="button"
          onClick={() => setTab("findings")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-smooth ${
            tab === "findings"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          扫描结果
        </button>
      </div>

      {tab === "rules" ? <RulesTab projectId={projectId} /> : <FindingsTab projectId={projectId} />}

      <ScanDialog open={scanOpen} onOpenChange={setScanOpen} />
    </main>
  );
}

// ── Rules Tab ────────────────────────────────────────────────────────────────

function RulesTab({ projectId }: { projectId: string | null }) {
  const [rules, setRules] = useState<SecurityRule[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SecurityRule | null>(null);

  const fetchProjects = async () => {
    try {
      const data = await apiClient.get<ProjectItem[] | { projects?: ProjectItem[] }>("/api/projects");
      setProjects(Array.isArray(data) ? data : data.projects ?? []);
    } catch {
      /* ignore */
    }
  };

  const getProjectName = (pid: string | null | undefined): string => {
    if (!pid) return "全局";
    const p = projects.find((x) => (x.id || x.cwd) === pid);
    return p ? (p.name || p.cwd || pid) : pid.slice(0, 8);
  };

  const fetchRules = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ workspace_id: "default" });
      if (projectId) params.set("project_id", projectId);
      const data = await apiClient.get<SecurityRule[] | { rules?: SecurityRule[] }>(
        `/api/security/rules?${params}`,
      );
      setRules(Array.isArray(data) ? data : data.rules ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, [projectId]);

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这条规则吗？")) return;
    try {
      await apiClient.del(`/api/security/rules/${id}?workspace_id=default`);
      toast({ title: "已删除" });
      fetchRules();
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  const handleSave = async (data: {
    workspace_id: string;
    project_id?: string | null;
    name: string;
    category: string;
    severity: string;
    pattern: string;
    description?: string;
    remediation?: string;
  }) => {
    try {
      if (editing) {
        await apiClient.put<SecurityRule>(`/api/security/rules/${editing.id}`, data);
      } else {
        await apiClient.post<SecurityRule>("/api/security/rules", data);
      }
      toast({ title: editing ? "已更新" : "已创建" });
      setDialogOpen(false);
      setEditing(null);
      fetchRules();
    } catch (err: any) {
      const detail = err?.body?.detail ?? "请检查输入";
      toast({ title: "保存失败", description: detail, variant: "destructive" });
    }
  };

  return (
    <>
      <div className="flex items-center justify-end">
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

      <section className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : rules.length === 0 ? (
          <div className="py-16 text-center">
            <Shield className="mx-auto h-8 w-8 text-muted-foreground/50" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-muted-foreground">暂无安全规则</p>
            <Button
              className="mt-5 gap-1.5"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> 创建第一条规则
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">作用域</th>
                  <th className="px-4 py-3 font-medium">类别</th>
                  <th className="px-4 py-3 font-medium">严重级别</th>
                  <th className="px-4 py-3 font-medium">模式</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-muted/40 transition-smooth">
                    <td className="px-4 py-3 font-medium">{rule.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant={rule.project_id ? "outline" : "default"}>
                        {getProjectName(rule.project_id)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{rule.category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={severityBadgeClass(rule.severity)}>
                        {rule.severity}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block">
                        {rule.pattern}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      {rule.enabled ? (
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
                          onClick={() => {
                            setEditing(rule);
                            setDialogOpen(true);
                          }}
                          title="编辑"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(rule.id)}
                          title="删除"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-destructive/10 hover:text-destructive"
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

      <RuleDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setEditing(null);
        }}
        rule={editing}
        defaultProjectId={projectId}
        onSave={handleSave}
      />
    </>
  );
}

// ── Findings Tab ─────────────────────────────────────────────────────────────

function FindingsTab({ projectId }: { projectId: string | null }) {
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [summary, setSummary] = useState<FindingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const { subscribe } = useWs();

  const fetchFindings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ workspace_id: "default" });
      if (statusFilter) params.set("status", statusFilter);
      if (projectId) params.set("project_id", projectId);
      const data = await apiClient.get<SecurityFinding[] | { findings?: SecurityFinding[] }>(
        `/api/security/findings?${params}`,
      );
      setFindings(Array.isArray(data) ? data : data.findings ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const params = new URLSearchParams({ workspace_id: "default" });
      if (projectId) params.set("project_id", projectId);
      const data = await apiClient.get<FindingSummary>(
        `/api/security/findings/summary?${params}`,
      );
      setSummary(data);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchFindings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, projectId]);

  useEffect(() => {
    fetchSummary();
  }, [projectId]);

  // Auto-refresh when the backend pushes a security.alert WS event so the
  // Findings tab stays in sync with newly detected high-severity issues.
  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "security.alert") return;
      fetchFindings();
      fetchSummary();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, statusFilter]);

  const handleDismiss = async (id: string) => {
    try {
      await apiClient.post(`/api/security/findings/${id}/dismiss`);
      toast({ title: "已忽略" });
      fetchFindings();
      fetchSummary();
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    }
  };

  return (
    <>
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Critical" count={summary.critical} color="red" />
          <SummaryCard label="High" count={summary.high} color="orange" />
          <SummaryCard label="Medium" count={summary.medium} color="yellow" />
          <SummaryCard label="Low" count={summary.low} color="gray" />
        </div>
      )}

      {/* Filter */}
      <div className="bg-card rounded-xl shadow-card border border-border/50 p-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">状态筛选</label>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={STATUS_FILTER_OPTIONS}
            className="max-w-xs rounded-lg border-border/50"
          />
        </div>
      </div>

      {/* Findings Table */}
      <section className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : findings.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-emerald-500/60" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-muted-foreground">暂无扫描结果</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">严重级别</th>
                  <th className="px-4 py-3 font-medium">类别</th>
                  <th className="px-4 py-3 font-medium">代码片段</th>
                  <th className="px-4 py-3 font-medium">位置</th>
                  <th className="px-4 py-3 font-medium">关联任务</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {findings.map((f) => (
                  <tr key={f.id} className="hover:bg-muted/40 transition-smooth">
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={severityBadgeClass(f.severity)}>
                        {f.severity}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{f.category}</td>
                    <td className="px-4 py-3 max-w-[250px]">
                      <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded truncate inline-block max-w-full">
                        {f.snippet}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {f.location || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {f.task_id ? (
                        <a
                          href={`/tasks/${f.task_id}`}
                          className="text-xs text-indigo-500 hover:underline font-mono"
                        >
                          {f.task_id.slice(0, 8)}…
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {f.status === "open" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-orange-600">
                          <ShieldAlert className="h-3 w-3" />
                          open
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <XCircle className="h-3 w-3" />
                          dismissed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        {f.status === "open" && (
                          <button
                            type="button"
                            onClick={() => handleDismiss(f.id)}
                            title="忽略"
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-xs text-muted-foreground transition-smooth hover:border-foreground/30 hover:text-foreground"
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  const colorMap: Record<string, string> = {
    red: "from-red-500/15 to-red-500/5 text-red-600",
    orange: "from-orange-500/15 to-orange-500/5 text-orange-600",
    yellow: "from-yellow-500/15 to-yellow-500/5 text-yellow-700",
    gray: "from-gray-500/15 to-gray-500/5 text-gray-600",
  };
  return (
    <div className="bg-card rounded-xl shadow-card border border-border/50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${colorMap[color] ?? colorMap.gray}`}>
          <span className="text-sm font-bold">{count}</span>
        </div>
      </div>
      <p className="mt-2 text-2xl font-semibold">{count}</p>
    </div>
  );
}

// ── Rule Dialog ──────────────────────────────────────────────────────────────

function RuleDialog({
  open,
  onOpenChange,
  rule,
  defaultProjectId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: SecurityRule | null;
  defaultProjectId: string | null;
  onSave: (data: {
    workspace_id: string;
    project_id?: string | null;
    name: string;
    category: string;
    severity: string;
    pattern: string;
    description?: string;
    remediation?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("secret_detection");
  const [severity, setSeverity] = useState("medium");
  const [pattern, setPattern] = useState("");
  const [description, setDescription] = useState("");
  const [remediation, setRemediation] = useState("");
  const [ruleProjectId, setRuleProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (rule) {
        setName(rule.name);
        setCategory(rule.category);
        setSeverity(rule.severity);
        setPattern(rule.pattern);
        setDescription(rule.description ?? "");
        setRemediation(rule.remediation ?? "");
        setRuleProjectId(rule.project_id ?? null);
      } else {
        setName("");
        setCategory("secret_detection");
        setSeverity("medium");
        setPattern("");
        setDescription("");
        setRemediation("");
        setRuleProjectId(defaultProjectId);
      }
      setError(null);
    }
  }, [open, rule, defaultProjectId]);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("名称必填");
    if (!pattern.trim()) return setError("模式（正则）必填");

    // validate regex
    try {
      new RegExp(pattern.trim());
    } catch {
      return setError("正则表达式无效");
    }

    setSaving(true);
    await onSave({
      workspace_id: "default",
      project_id: ruleProjectId,
      name: name.trim(),
      category,
      severity,
      pattern: pattern.trim(),
      description: description.trim() || undefined,
      remediation: remediation.trim() || undefined,
    });
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background/95 backdrop-blur-xl max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "编辑规则" : "新建规则"}</DialogTitle>
          <DialogDescription>
            {rule ? "修改安全规则配置" : "创建一条新的安全扫描规则"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="名称" required>
            <Input
              autoFocus
              placeholder="规则名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border-border/50"
            />
          </Field>

          <Field label="作用域">
            <ProjectScopeSelector
              value={ruleProjectId}
              onChange={(v) => setRuleProjectId(v)}
              className="w-full"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="类别" required>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                options={CATEGORY_OPTIONS}
                className="rounded-lg border-border/50"
              />
            </Field>
            <Field label="严重级别" required>
              <Select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                options={SEVERITY_OPTIONS}
                className="rounded-lg border-border/50"
              />
            </Field>
          </div>

          <Field label="模式（正则表达式）" required>
            <Input
              placeholder="e.g. (AKIA|AGPA)[A-Z0-9]{16}"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="rounded-lg border-border/50 font-mono text-xs"
            />
          </Field>

          <Field label="描述">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="规则描述"
              rows={2}
              className="flex w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </Field>

          <Field label="修复建议">
            <textarea
              value={remediation}
              onChange={(e) => setRemediation(e.target.value)}
              placeholder="发现该问题后的修复建议"
              rows={2}
              className="flex w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            {saving ? "保存中…" : rule ? "保存" : "创建"}
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

// ── Scan Dialog ──────────────────────────────────────────────────────────────

function ScanDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setScanning(false);
      setResults(null);
      setError(null);
    }
  }, [open]);

  const handleScan = async () => {
    if (!text.trim()) {
      setError("请输入要扫描的内容");
      return;
    }
    setError(null);
    setScanning(true);
    setResults(null);
    try {
      const data = await apiClient.post<ScanFinding[]>("/api/security/scan", {
        text,
        workspace_id: "default",
      });
      setResults(Array.isArray(data) ? data : []);
    } catch (err: any) {
      const detail = err?.body?.detail ?? "扫描失败，请稍后重试";
      setError(typeof detail === "string" ? detail : "扫描失败");
      toast({ title: "扫描失败", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background/95 backdrop-blur-xl max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            手动扫描
          </DialogTitle>
          <DialogDescription>
            扫描文本内容中的潜在安全风险（硬编码凭据、注入攻击、危险命令等）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="粘贴代码或 Agent 输出内容..."
            rows={8}
            disabled={scanning}
            className="flex w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
          />

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {results !== null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  扫描结果
                </span>
                <span className="text-xs text-muted-foreground">
                  共 {results.length} 项
                </span>
              </div>

              {results.length === 0 ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-6 text-center">
                  <ShieldCheck
                    className="mx-auto h-8 w-8 text-emerald-500"
                    strokeWidth={1.5}
                  />
                  <p className="mt-2 text-sm font-medium text-emerald-600">
                    未发现安全问题
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {results.map((f, idx) => (
                    <div
                      key={`${f.rule_id}-${idx}`}
                      className="rounded-xl border border-border/50 bg-card shadow-card p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={severityBadgeClass(f.severity)}
                        >
                          {f.severity}
                        </Badge>
                        <Badge variant="secondary">{f.category}</Badge>
                        {f.location && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {f.location}
                          </span>
                        )}
                      </div>
                      <code className="block text-xs font-mono bg-muted px-2 py-1.5 rounded break-all">
                        {f.snippet}
                      </code>
                      {f.description && (
                        <p className="text-sm text-foreground/90">{f.description}</p>
                      )}
                      {f.remediation && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">修复建议：</span>
                          {f.remediation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={scanning}>
            {results !== null ? "关闭" : "取消"}
          </Button>
          <Button onClick={handleScan} disabled={scanning} className="gap-1.5">
            <ScanLine className="h-4 w-4" />
            {scanning ? "扫描中…" : results !== null ? "重新扫描" : "开始扫描"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
