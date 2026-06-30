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
import { SimpleMarkdown } from "@tide/views/shared/SimpleMarkdown";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Skill {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description?: string | null;
  category?: string | null;
  tags: string[];
  content: string;
  version: number;
  enabled: number;
  source?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "", label: "全部分类" },
  { value: "general", label: "通用 (general)" },
  { value: "development", label: "开发 (development)" },
  { value: "security", label: "安全 (security)" },
  { value: "review", label: "审查 (review)" },
  { value: "deployment", label: "部署 (deployment)" },
];

const CATEGORY_LABELS: Record<string, string> = {
  general: "通用",
  development: "开发",
  security: "安全",
  review: "审查",
  deployment: "部署",
};

const CATEGORY_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  general: "secondary",
  development: "default",
  security: "outline",
  review: "secondary",
  deployment: "outline",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsSkillsPage() {
  const router = useRouter();
  const { hydrated } = useAuth();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Skill | null>(null);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  // Fetch skills
  const fetchSkills = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace_id: "default" });
      if (category) params.set("category", category);
      const data = await apiClient.get<Skill[]>(`/api/skills?${params}`);
      setSkills(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hydrated) fetchSkills();
  }, [hydrated, category]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!debounced) return skills;
    const q = debounced.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [skills, debounced]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Toggle enabled
  const toggleEnabled = async (skill: Skill) => {
    const newEnabled = skill.enabled ? 0 : 1;
    try {
      await apiClient.put<Skill>(`/api/skills/${skill.id}?workspace_id=default`, { enabled: newEnabled });
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, enabled: newEnabled } : s))
      );
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await apiClient.del(`/api/skills/${deleting.id}?workspace_id=default`);
      toast({ title: "已删除", description: deleting.name });
      setDeleting(null);
      fetchSkills();
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  // Save (create/update)
  const handleSave = async (data: {
    name: string;
    slug: string;
    description: string;
    category: string;
    tags: string;
    content: string;
  }) => {
    setSaving(true);
    try {
      const body: any = {
        workspace_id: "default",
        name: data.name,
        slug: data.slug,
        description: data.description,
        category: data.category || "general",
        tags: data.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        content: data.content,
      };
      if (editing) {
        await apiClient.put<Skill>(`/api/skills/${editing.id}?workspace_id=default`, body);
      } else {
        await apiClient.post<Skill>("/api/skills", body);
      }
      if (!editing) {
        toast({ title: "已创建", description: data.name });
      }
      setDialogOpen(false);
      setEditing(null);
      fetchSkills();
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
              <Sparkles className="h-3.5 w-3.5" />
              <span>SETTINGS · SKILLS</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">技能库</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              管理 Agent 执行时的技能指南，提升输出质量
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
              <Plus className="h-4 w-4" /> 新建技能
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
              placeholder="搜索技能名称 / slug / 描述 / 标签…"
              className="pl-9 rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
            />
          </div>
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-48"
            options={CATEGORY_OPTIONS}
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
              {debounced || category ? "未找到匹配的技能" : "暂无技能"}
            </p>
            {!debounced && !category && (
              <Button
                className="mt-5 gap-1.5"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> 创建第一个技能
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">分类</th>
                  <th className="px-4 py-3 font-medium">标签</th>
                  <th className="px-4 py-3 font-medium">来源</th>
                  <th className="px-4 py-3 font-medium">版本</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {paged.map((skill) => (
                  <tr key={skill.id} className="hover:bg-muted/40 transition-smooth">
                    <td className="px-4 py-3">
                      <div className="font-medium">{skill.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{skill.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={CATEGORY_VARIANT[skill.category || "general"] ?? "secondary"}>
                        {CATEGORY_LABELS[skill.category || "general"] ?? skill.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {skill.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        {skill.tags.length > 3 && (
                          <span className="text-[11px] text-muted-foreground">
                            +{skill.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{skill.source || "custom"}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      v{skill.version}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleEnabled(skill)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          skill.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                            skill.enabled ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(skill);
                            setDialogOpen(true);
                          }}
                          title="编辑"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(skill)}
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
      <SkillDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setEditing(null);
        }}
        skill={editing}
        saving={saving}
        onSave={handleSave}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定删除技能 <strong>{deleting?.name}</strong>？此操作不可撤销。
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

// ─── Skill Dialog ────────────────────────────────────────────────────────────

function SkillDialog({
  open,
  onOpenChange,
  skill,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  skill: Skill | null;
  saving: boolean;
  onSave: (data: {
    name: string;
    slug: string;
    description: string;
    category: string;
    tags: string;
    content: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [cat, setCat] = useState("general");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (open) {
      if (skill) {
        setName(skill.name);
        setSlug(skill.slug);
        setDescription(skill.description || "");
        setCat(skill.category || "general");
        setTags(skill.tags.join(", "));
        setContent(skill.content);
        setSlugManual(true);
        setPreview(true);
      } else {
        setName("");
        setSlug("");
        setDescription("");
        setCat("general");
        setTags("");
        setContent("");
        setSlugManual(false);
        setPreview(false);
      }
    }
  }, [open, skill]);

  useEffect(() => {
    if (!slugManual && name) {
      setSlug(slugify(name));
    }
  }, [name, slugManual]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) {
      toast({ title: "请填写必填字段", variant: "destructive" });
      return;
    }
    onSave({ name, slug: slug || slugify(name), description, category: cat, tags, content });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{skill ? "编辑技能" : "新建技能"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">名称 *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="技能名称" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Slug</label>
              <Input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugManual(true);
                }}
                placeholder="auto-generated-slug"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">描述</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述此技能的用途"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">分类</label>
              <Select
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                options={[
                  { value: "general", label: "通用 (general)" },
                  { value: "development", label: "开发 (development)" },
                  { value: "security", label: "安全 (security)" },
                  { value: "review", label: "审查 (review)" },
                  { value: "deployment", label: "部署 (deployment)" },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">标签</label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="逗号分隔，如: git, code-review"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">内容 (Markdown) *</label>
              {content && (
                <button
                  type="button"
                  onClick={() => setPreview((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {preview ? "编辑" : "预览"}
                </button>
              )}
            </div>
            {preview ? (
              <div className="w-full rounded-lg border border-border/50 bg-background px-4 py-3 text-sm overflow-y-auto overflow-x-hidden max-h-[400px] min-h-[200px] prose prose-sm dark:prose-invert break-words">
                <SimpleMarkdown source={content} />
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="在此输入技能指南内容（支持 Markdown）…"
                rows={14}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[200px]"
              />
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "保存中…" : skill ? "保存修改" : "创建技能"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
