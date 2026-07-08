"use client";

/**
 * 带 @mention 的文本输入组件。
 *
 * - Textarea 输入，检测 `@` 字符弹出候选下拉列表
 * - 候选：项目成员 + 专家团/小队
 * - 选择后插入 `@name` 到文本，并记录 mention
 * - 提交时解析出 mentions 数组 [{type, id, name}]
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Send, Users, Bot } from "lucide-react";
import { Button } from "@tide/ui";
import { apiClient, useProjectMembers } from "@tide/core";
import type { MentionItem } from "@tide/core";

export interface MentionInputProps {
  projectId?: string;
  onSubmit: (content: string, mentions: MentionItem[]) => void;
  placeholder?: string;
  submitting?: boolean;
}

interface Candidate {
  type: "member" | "expert_team" | "squad";
  id: string;
  name: string;
}

interface ExpertTeamRow {
  id: string;
  name: string;
  is_squad?: number;
  enabled?: number;
}

export function MentionInput({
  projectId,
  onSubmit,
  placeholder,
  submitting,
}: MentionInputProps) {
  const [text, setText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MentionItem[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: membersResp } = useProjectMembers(projectId);
  const [expertTeams, setExpertTeams] = useState<ExpertTeamRow[]>([]);

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

  const allCandidates = useMemo<Candidate[]>(() => {
    const list: Candidate[] = [];
    for (const m of membersResp?.members ?? []) {
      list.push({
        type: "member",
        id: m.id,
        name: m.display_name || m.username,
      });
    }
    for (const t of expertTeams) {
      list.push({
        type: t.is_squad ? "squad" : "expert_team",
        id: t.id,
        name: t.name,
      });
    }
    return list;
  }, [membersResp, expertTeams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCandidates.slice(0, 8);
    return allCandidates
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allCandidates, query]);

  const handleChange = (value: string) => {
    setText(value);
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/@([^\s@]*)$/);
    if (match) {
      setQuery(match[1]);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
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
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    const content = text.trim();
    if (!content || submitting) return;
    // 仅保留仍出现在文本中的 mention
    const mentions = picked.filter((m) => m.name && content.includes(`@${m.name}`));
    onSubmit(content, mentions);
    setText("");
    setPicked([]);
    setShowDropdown(false);
  };

  return (
    <div className="relative">
      {showDropdown && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-64 overflow-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg">
          {filtered.map((c) => (
            <button
              key={`${c.type}:${c.id}`}
              type="button"
              onClick={() => handleSelect(c)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {c.type === "member" ? (
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Bot className="h-3.5 w-3.5 text-primary" />
              )}
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {c.type === "member" ? "成员" : c.type === "squad" ? "小队" : "专家团"}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-background focus-within:ring-2 focus-within:ring-ring">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          rows={3}
          placeholder={placeholder || "输入评论，使用 @ 提及成员或专家团触发执行…"}
          className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-border/40 px-2 py-1.5">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <AtSign className="h-3 w-3" />
            @ 提及专家团触发 Agent · ⌘/Ctrl+Enter 发送
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
