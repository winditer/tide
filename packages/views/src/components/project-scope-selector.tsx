"use client";
import { useState, useEffect } from "react";
import { apiClient } from "@tide/core";
import { cn } from "@tide/ui";

interface ProjectScopeSelectorProps {
  value: string | null; // null = 全局
  onChange: (projectId: string | null) => void;
  className?: string;
}

export function ProjectScopeSelector({ value, onChange, className }: ProjectScopeSelectorProps) {
  const [projects, setProjects] = useState<any[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    apiClient
      .get<{ projects?: any[] }>("/api/projects")
      .then((data) => {
        const list = data?.projects ?? [];
        setProjects(Array.isArray(list) ? list : []);
      })
      .catch(() => setProjects([]));
    // 加载项目组列表，用于筛选栏按项目组维度过滤（value 形如 group:<group_id>）
    apiClient
      .get<any>("/api/project-groups")
      .then((data) => {
        const list = data?.groups || (Array.isArray(data) ? data : []);
        setGroups(Array.isArray(list) ? list.map((g: any) => ({ id: g.id, name: g.name })) : []);
      })
      .catch(() => setGroups([]));
  }, []);

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">作用域</label>
      <select
        className="flex-1 min-w-0 border rounded-md px-3 py-2 text-sm bg-background"
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">全局</option>
        {groups.length > 0 && (
          <optgroup label="项目组">
            {groups.map((g) => (
              <option key={`group:${g.id}`} value={`group:${g.id}`}>
                {g.name}（组内所有项目）
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="项目">
          {projects.map((p) => (
            <option key={p.id || p.cwd} value={p.id || p.cwd}>
              {p.name || p.cwd}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

// ─── Multi-select version ──────────────────────────────────────────────────

interface ProjectMultiScopeSelectorProps {
  /** 当前选中的目标数组，项目组带 "group:" 前缀。空数组 = 全局 */
  value: string[];
  onChange: (targets: string[]) => void;
  className?: string;
  /** 为 true 时显示"全局"选项（取消所有选中 = 全局） */
  showGlobalHint?: boolean;
}

export function ProjectMultiScopeSelector({
  value,
  onChange,
  className,
  showGlobalHint = true,
}: ProjectMultiScopeSelectorProps) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    // 获取项目列表
    apiClient
      .get<any>("/api/projects?workspace_id=default")
      .then((data) => {
        const list = data?.projects || (Array.isArray(data) ? data : []);
        setProjects(list.map((p: any) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {});
    // 获取项目组列表
    apiClient
      .get<any>("/api/project-groups?workspace_id=default")
      .then((data) => {
        const list = data?.groups || (Array.isArray(data) ? data : []);
        setGroups(list.map((g: any) => ({ id: g.id, name: g.name })));
      })
      .catch(() => {});
  }, []);

  const toggle = (target: string) => {
    if (value.includes(target)) {
      onChange(value.filter((t) => t !== target));
    } else {
      onChange([...value, target]);
    }
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-0.5">
        {groups.length > 0 && (
          <>
            <div className="text-xs font-medium text-muted-foreground px-1 pt-0.5 pb-0.5">
              项目组
            </div>
            {groups.map((g) => {
              const key = `group:${g.id}`;
              return (
                <label
                  key={key}
                  className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-muted/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={value.includes(key)}
                    onChange={() => toggle(key)}
                    className="rounded"
                  />
                  <span className="text-sm">{g.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    组内所有项目
                  </span>
                </label>
              );
            })}
          </>
        )}
        <div className="text-xs font-medium text-muted-foreground px-1 pt-1 pb-0.5">
          项目
        </div>
        {projects.map((p) => (
          <label
            key={p.id}
            className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-muted/50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={value.includes(p.id)}
              onChange={() => toggle(p.id)}
              className="rounded"
            />
            <span className="text-sm">{p.name}</span>
          </label>
        ))}
        {projects.length === 0 && groups.length === 0 && (
          <div className="text-xs text-muted-foreground px-1 py-2">
            暂无可选项目
          </div>
        )}
      </div>
      {showGlobalHint && value.length === 0 && (
        <p className="text-xs text-muted-foreground">未选择任何项目时为全局生效</p>
      )}
    </div>
  );
}
