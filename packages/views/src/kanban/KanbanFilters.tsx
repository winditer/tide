"use client";

import { Input } from "@lark2codex/ui";

interface KanbanFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export function KanbanFilters({ search, onSearchChange }: KanbanFiltersProps) {
  return (
    <div className="flex items-center gap-3">
      <Input
        placeholder="搜索卡片..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-64"
      />
    </div>
  );
}
