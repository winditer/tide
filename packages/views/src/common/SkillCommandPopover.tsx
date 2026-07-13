"use client";

/**
 * Skill 搜索弹窗组件（Slash Command）
 *
 * - 输入 `/` 后弹出，按 name/slug/description 模糊搜索
 * - 分组：最近使用 + 按 category 分组
 * - 键盘导航：↑↓ 移动 + Enter 确认 + Escape 关闭
 * - localStorage 记录最近使用（tide_skill_recent）
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Zap, Clock } from "lucide-react";
import { Badge } from "@tide/ui";
import { apiClient } from "@tide/core";

export interface SkillItem {
  slug: string;
  name: string;
  category: string;
  description?: string;
}

export interface SkillCommandPopoverProps {
  open: boolean;
  query: string;
  projectId?: string;
  onSelect: (skill: { slug: string; name: string; category: string }) => void;
  onClose: () => void;
}

/** localStorage key for recent skills */
const RECENT_KEY = "tide_skill_recent";
const RECENT_MAX = 10;
const GROUP_MAX = 10;
const TOTAL_MAX = 50;

interface RecentEntry {
  slug: string;
  name: string;
  category: string;
}

function loadRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RecentEntry[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: RecentEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* ignore quota / disabled storage */
  }
}

interface SkillGroup {
  key: string;
  label: string;
  items: SkillItem[];
}

/** Category display labels */
const CATEGORY_LABELS: Record<string, string> = {
  "ai-agent": "AI Agent",
  testing: "Testing",
  devops: "DevOps",
  security: "Security",
  general: "General",
};

function getCategoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

export function SkillCommandPopover({
  open,
  query,
  projectId,
  onSelect,
  onClose,
}: SkillCommandPopoverProps) {
  const [allSkills, setAllSkills] = useState<SkillItem[]>([]);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load skills on mount
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      workspace_id: "default",
      enabled_only: "1",
      limit: "500",
    });
    if (projectId) params.set("project_id", projectId);
    apiClient
      .get<SkillItem[] | { skills: SkillItem[] }>(`/api/skills?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const skills = Array.isArray(data) ? data : (data as any)?.skills ?? [];
        setAllSkills(skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load recent on mount
  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  // Reset active index on query/open change
  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // Filter skills by query (fuzzy: name/slug/description substring)
  const filtered = useMemo<SkillItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSkills;
    return allSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q),
    );
  }, [allSkills, query]);

  // Build groups
  const groups = useMemo<SkillGroup[]>(() => {
    const result: SkillGroup[] = [];
    let totalCount = 0;

    // Recent group
    const q = query.trim().toLowerCase();
    const recentItems: SkillItem[] = [];
    const recentSlugs = new Set<string>();
    for (const r of recent) {
      if (totalCount >= TOTAL_MAX) break;
      if (recentSlugs.has(r.slug)) continue;
      // Check it matches the query
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.slug.toLowerCase().includes(q)
      )
        continue;
      // Check it exists in allSkills (still available)
      const found = allSkills.find((s) => s.slug === r.slug);
      if (found) {
        recentItems.push(found);
        recentSlugs.add(r.slug);
        totalCount++;
      }
      if (recentItems.length >= GROUP_MAX) break;
    }
    if (recentItems.length > 0) {
      result.push({ key: "recent", label: "最近使用", items: recentItems });
    }

    // Group by category
    const categoryMap = new Map<string, SkillItem[]>();
    for (const s of filtered) {
      if (totalCount >= TOTAL_MAX) break;
      const cat = s.category || "general";
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      const list = categoryMap.get(cat)!;
      if (list.length >= GROUP_MAX) continue;
      list.push(s);
      totalCount++;
    }
    for (const [cat, items] of categoryMap) {
      if (items.length > 0) {
        result.push({ key: cat, label: getCategoryLabel(cat), items });
      }
    }

    return result;
  }, [filtered, recent, allSkills, query]);

  // Flatten for keyboard navigation
  const flatItems = useMemo(
    () => groups.flatMap((g) => g.items.map((item) => ({ groupKey: g.key, item }))),
    [groups],
  );

  // Handle keyboard events (called from parent)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % (flatItems.length || 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + (flatItems.length || 1)) % (flatItems.length || 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = flatItems[activeIndex];
        if (target) handleSelect(target.item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, flatItems, activeIndex, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current.querySelector("[data-active='true']");
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleSelect = (skill: SkillItem) => {
    onSelect({ slug: skill.slug, name: skill.name, category: skill.category });
    // Update recent
    const entry: RecentEntry = { slug: skill.slug, name: skill.name, category: skill.category };
    const next = [entry, ...recent.filter((r) => r.slug !== skill.slug)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
  };

  if (!open || flatItems.length === 0) return null;

  let flatIdx = -1;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-80 overflow-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
    >
      {groups.map((g) => (
        <div key={g.key} className="py-0.5">
          <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {g.key === "recent" ? (
              <Clock className="h-3 w-3" />
            ) : (
              <Zap className="h-3 w-3" />
            )}
            {g.label}
          </div>
          {g.items.map((skill) => {
            flatIdx += 1;
            const isActive = flatIdx === activeIndex;
            return (
              <button
                key={`${g.key}:${skill.slug}`}
                type="button"
                data-active={isActive}
                onClick={() => handleSelect(skill)}
                onMouseEnter={() => {
                  const idx = flatItems.findIndex(
                    (f) => f.groupKey === g.key && f.item.slug === skill.slug,
                  );
                  if (idx >= 0) setActiveIndex(idx);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  isActive ? "bg-accent" : "hover:bg-accent"
                }`}
              >
                <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="truncate font-medium">{skill.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  /{skill.slug}
                </span>
                <Badge
                  variant="secondary"
                  className="ml-auto shrink-0 text-[9px] px-1 py-0"
                >
                  {skill.category || "general"}
                </Badge>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
