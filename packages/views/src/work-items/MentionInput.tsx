"use client";

/**
 * 带 @mention 的文本输入组件（自由协作模式）。
 *
 * - Textarea 输入，检测 `@` 字符弹出候选下拉列表
 * - 候选：项目成员 + 专家团/小队 + 单个 Agent（仅已启用且当前用户/项目有权使用）
 * - 下拉列表按类型分组展示（最近使用 / Agent / 专家团·小队 / 用户），空组隐藏
 * - 支持实时搜索：按名称、拼音首字母匹配；搜索结果保持分组结构
 * - 记录最近 @mention 过的对象（localStorage: tide_mention_recent），置顶展示
 * - 智能排序：最近使用 > 项目关联 > 历史协作 > 名称字母序
 * - 支持键盘上下键导航 + Enter 选择 + Esc 关闭
 * - 选择后插入 `@name` 到文本，并记录 mention
 * - 提交时解析出 mentions 数组 [{type, id, name}]
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Send, Users, Bot, Clock } from "lucide-react";
import { Button } from "@tide/ui";
import { apiClient, useProjectMembers, useWorkItemComments } from "@tide/core";
import type { MentionItem } from "@tide/core";
import { SkillCommandPopover } from "../common/SkillCommandPopover";

export interface MentionInputProps {
  projectId?: string;
  /** 当前工作项 id，用于「历史协作过的对象优先」排序 */
  workItemId?: string;
  onSubmit: (content: string, mentions: MentionItem[], skills?: {slug: string, name: string}[]) => void;
  placeholder?: string;
  submitting?: boolean;
}

type CandidateType = "member" | "expert_team" | "squad" | "agent";

interface Candidate {
  type: CandidateType;
  id: string;
  name: string;
}

interface ExpertTeamRow {
  id: string;
  name: string;
  is_squad?: number;
  enabled?: number;
}

interface AgentRow {
  id: string;
  name?: string;
  label?: string;
}

/** 最近使用记录（localStorage） */
const RECENT_KEY = "tide_mention_recent";
const RECENT_MAX = 5;
const RECENT_STORE_MAX = 30;

interface RecentEntry {
  type: CandidateType;
  id: string;
  name: string;
}

function loadRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: RecentEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_STORE_MAX)));
  } catch {
    /* ignore quota / disabled storage */
  }
}

// ── 拼音首字母匹配（无依赖轻量实现） ──────────────────────────
// 依据 GB2312 拼音排序的边界字，用 localeCompare('zh-CN') 判定单个汉字的声母。
// 覆盖绝大多数常用简体汉字；非中文字符按小写返回。
const PINYIN_BOUNDARIES: Array<[string, string]> = [
  ["a", "啊"], ["b", "芭"], ["c", "擦"], ["d", "搭"], ["e", "蛾"],
  ["f", "发"], ["g", "噶"], ["h", "哈"], ["j", "击"], ["k", "喀"],
  ["l", "垃"], ["m", "妈"], ["n", "拿"], ["o", "哦"], ["p", "啪"],
  ["q", "期"], ["r", "然"], ["s", "撒"], ["t", "塌"], ["w", "挖"],
  ["x", "昔"], ["y", "压"], ["z", "匝"],
];

function pinyinInitial(ch: string): string {
  if (/[a-z0-9]/i.test(ch)) return ch.toLowerCase();
  // 仅处理 CJK 统一表意文字区间
  if (ch < "\u4e00" || ch > "\u9fff") return ch.toLowerCase();
  let letter = "";
  for (const [ltr, boundary] of PINYIN_BOUNDARIES) {
    if (ch.localeCompare(boundary, "zh-CN") >= 0) {
      letter = ltr;
    } else {
      break;
    }
  }
  return letter || ch.toLowerCase();
}

/** 判断候选名称是否匹配查询词（名称子串 / 拼音首字母 / 英文单词首字母） */
function matchName(name: string, q: string): boolean {
  if (!q) return true;
  const lower = name.toLowerCase();
  if (lower.includes(q)) return true;
  const chars = Array.from(name);
  const initials = chars.map(pinyinInitial).join("");
  if (initials.includes(q)) return true;
  const wordInitials = name
    .split(/[\s_\-/]+/)
    .map((w) => w.charAt(0))
    .join("")
    .toLowerCase();
  if (wordInitials && wordInitials.includes(q)) return true;
  return false;
}

const TYPE_LABEL: Record<CandidateType, string> = {
  member: "成员",
  agent: "Agent",
  squad: "小队",
  expert_team: "专家团",
};

interface Group {
  key: string;
  label: string;
  items: Candidate[];
}

export function MentionInput({
  projectId,
  workItemId,
  onSubmit,
  placeholder,
  submitting,
}: MentionInputProps) {
  const [text, setText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MentionItem[]>([]);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showSkillPopover, setShowSkillPopover] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [pickedSkills, setPickedSkills] = useState<{slug: string, name: string}[]>([]);

  const { data: membersResp } = useProjectMembers(projectId);
  const { data: commentsData } = useWorkItemComments(workItemId);
  const [expertTeams, setExpertTeams] = useState<ExpertTeamRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ workspace_id: "default", exclude_disabled_agents: "true" });
    if (projectId) params.set("project_id", projectId);
    apiClient
      .get<ExpertTeamRow[]>(`/api/expert-teams?${params.toString()}`)
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          setExpertTeams(data.filter((t) => t.enabled === 1 || t.enabled === undefined));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 拉取可 @ 的单个 Agent：仅已启用（overrides 默认过滤）+ 当前用户/项目有权使用（scope_filter）
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ scope_filter: "true" });
    if (projectId) params.set("project_id", projectId);
    apiClient
      .get<{ agents: AgentRow[] }>(`/api/agents?${params.toString()}`)
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.agents)) {
          setAgents(data.agents);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const allCandidates = useMemo<Candidate[]>(() => {
    const list: Candidate[] = [];
    for (const m of membersResp?.members ?? []) {
      list.push({ type: "member", id: m.id, name: m.display_name || m.username });
    }
    for (const t of expertTeams) {
      list.push({ type: t.is_squad ? "squad" : "expert_team", id: t.id, name: t.name });
    }
    for (const a of agents) {
      list.push({ type: "agent", id: a.id, name: a.name || a.label || a.id });
    }
    return list;
  }, [membersResp, expertTeams, agents]);

  // 当前工作项历史协作过的对象（评论 mentions 去重），用于排序加权
  const historySet = useMemo(() => {
    const set = new Set<string>();
    for (const c of commentsData ?? []) {
      for (const m of c.mentions ?? []) {
        if (m?.type && m?.id) set.add(`${m.type}:${m.id}`);
      }
    }
    return set;
  }, [commentsData]);

  // 分组 + 搜索 + 排序
  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const byKey = new Map<string, Candidate>();
    for (const c of allCandidates) byKey.set(`${c.type}:${c.id}`, c);

    const inHistory = (c: Candidate) => historySet.has(`${c.type}:${c.id}`);

    // 组内排序：历史协作优先，其余按名称字母序（zh 排序对拼音友好）
    const sortItems = (items: Candidate[]) =>
      [...items].sort((a, b) => {
        const ha = inHistory(a) ? 0 : 1;
        const hb = inHistory(b) ? 0 : 1;
        if (ha !== hb) return ha - hb;
        return a.name.localeCompare(b.name, "zh-CN");
      });

    const filterFn = (c: Candidate) => matchName(c.name, q);

    // 最近使用组：按存储顺序（recency），解析为当前可用候选
    const recentItems: Candidate[] = [];
    const seen = new Set<string>();
    for (const r of recent) {
      const key = `${r.type}:${r.id}`;
      if (seen.has(key)) continue;
      const cand = byKey.get(key) ?? { type: r.type, id: r.id, name: r.name };
      if (!filterFn(cand)) continue;
      recentItems.push(cand);
      seen.add(key);
      if (recentItems.length >= RECENT_MAX) break;
    }

    const agentItems = sortItems(allCandidates.filter((c) => c.type === "agent").filter(filterFn));
    const teamItems = sortItems(
      allCandidates.filter((c) => c.type === "expert_team" || c.type === "squad").filter(filterFn),
    );
    const memberItems = sortItems(allCandidates.filter((c) => c.type === "member").filter(filterFn));

    const result: Group[] = [];
    if (recentItems.length) result.push({ key: "recent", label: "最近使用", items: recentItems });
    if (agentItems.length) result.push({ key: "agent", label: "Agent", items: agentItems });
    if (teamItems.length) result.push({ key: "team", label: "专家团 / 小队", items: teamItems });
    if (memberItems.length) result.push({ key: "member", label: "用户", items: memberItems });
    return result;
  }, [allCandidates, recent, historySet, query]);

  // 扁平化用于键盘导航
  const flatItems = useMemo(
    () => groups.flatMap((g) => g.items.map((c) => ({ groupKey: g.key, c }))),
    [groups],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query, showDropdown]);

  const handleChange = (value: string) => {
    setText(value);
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);

    const mentionMatch = before.match(/@([^\s@]*)$/);
    const skillMatch = before.match(/\/([a-z0-9\-]*)$/i);

    if (mentionMatch) {
      setQuery(mentionMatch[1]);
      setShowDropdown(true);
      setShowSkillPopover(false);
    } else if (skillMatch) {
      setSkillQuery(skillMatch[1]);
      setShowSkillPopover(true);
      setShowDropdown(false);
    } else {
      setShowDropdown(false);
      setShowSkillPopover(false);
    }
  };

  const handleSelect = (c: Candidate) => {
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const replaced = before.replace(/@([^\s@]*)$/, `@${c.name} `);
    const nextText = replaced + after;
    setText(nextText);
    setShowDropdown(false);
    setQuery("");
    setPicked((prev) => {
      if (prev.some((m) => m.id === c.id && m.type === c.type)) return prev;
      return [...prev, { type: c.type, id: c.id, name: c.name }];
    });
    // 更新最近使用（去重后置顶）
    setRecent((prev) => {
      const entry: RecentEntry = { type: c.type, id: c.id, name: c.name };
      const next = [entry, ...prev.filter((r) => !(r.type === c.type && r.id === c.id))];
      saveRecent(next);
      return next;
    });
    textareaRef.current?.focus();
  };

  const handleSkillSelect = (skill: {slug: string, name: string}) => {
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const replaced = before.replace(/\/[a-z0-9\-]*$/i, `/${skill.slug} `);
    setText(replaced + after);
    setShowSkillPopover(false);
    setSkillQuery("");
    setPickedSkills(prev =>
      prev.some(s => s.slug === skill.slug) ? prev : [...prev, skill]
    );
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSkillPopover) {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSkillPopover(false);
        return;
      }
      // SkillCommandPopover internally handles other keyboard events
    }
    if (showDropdown && flatItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % flatItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const target = flatItems[activeIndex] ?? flatItems[0];
        if (target) handleSelect(target.c);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowDropdown(false);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const content = text.trim();
    if (!content || submitting) return;
    // 仅保留仍出现在文本中的 mention
    const mentions = picked.filter((m) => m.name && content.includes(`@${m.name}`));
    const skills = pickedSkills.filter(s => content.includes(`/${s.slug}`));
    onSubmit(content, mentions, skills);
    setText("");
    setPicked([]);
    setPickedSkills([]);
    setShowDropdown(false);
    setShowSkillPopover(false);
  };

  const dropdownVisible = showDropdown && flatItems.length > 0;

  return (
    <div className="relative">
      {showSkillPopover && (
        <SkillCommandPopover
          open={showSkillPopover}
          query={skillQuery}
          projectId={projectId}
          onSelect={handleSkillSelect}
          onClose={() => setShowSkillPopover(false)}
        />
      )}

      {dropdownVisible && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-72 overflow-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg">
          {(() => {
            let flatIdx = -1;
            return groups.map((g) => (
              <div key={g.key} className="py-0.5">
                <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {g.key === "recent" && <Clock className="h-3 w-3" />}
                  {g.label}
                </div>
                {g.items.map((c) => {
                  flatIdx += 1;
                  const isActive = flatIdx === activeIndex;
                  return (
                    <button
                      key={`${g.key}:${c.type}:${c.id}`}
                      type="button"
                      onClick={() => handleSelect(c)}
                      onMouseEnter={() => setActiveIndex(flatItems.findIndex((f) => f.groupKey === g.key && f.c.id === c.id && f.c.type === c.type))}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                        isActive ? "bg-accent" : "hover:bg-accent"
                      }`}
                    >
                      {c.type === "member" ? (
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      )}
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {TYPE_LABEL[c.type]}
                      </span>
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-background focus-within:ring-2 focus-within:ring-ring">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder={placeholder || "输入评论，使用 @ 提及成员、Agent 或专家团触发执行…"}
          className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-border/40 px-2 py-1.5">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <AtSign className="h-3 w-3" />
            @ 提及 Agent / 专家团 · / 调用技能 · ⌘/Ctrl+Enter 发送
          </span>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="h-7 gap-1 px-3 text-xs"
          >
            <Send className="h-3 w-3" />
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
