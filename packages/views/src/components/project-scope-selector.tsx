"use client";
import { useState, useEffect } from "react";
import { apiClient } from "@tide/core";

interface ProjectScopeSelectorProps {
  value: string | null; // null = 全局
  onChange: (projectId: string | null) => void;
  className?: string;
}

export function ProjectScopeSelector({ value, onChange, className }: ProjectScopeSelectorProps) {
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    apiClient
      .get<{ projects?: any[] }>("/api/projects")
      .then((data) => {
        const list = data?.projects ?? [];
        setProjects(Array.isArray(list) ? list : []);
      })
      .catch(() => setProjects([]));
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
        {projects.map((p) => (
          <option key={p.id || p.cwd} value={p.id || p.cwd}>
            {p.name || p.cwd}
          </option>
        ))}
      </select>
    </div>
  );
}
