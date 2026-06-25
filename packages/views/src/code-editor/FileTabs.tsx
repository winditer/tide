"use client";

import { X } from "lucide-react";

export interface FileTab {
  path: string;
  name: string;
  modified?: boolean;
}

interface FileTabsProps {
  tabs: FileTab[];
  activeTab: string;
  onTabSelect: (path: string) => void;
  onTabClose: (path: string) => void;
  theme?: "light" | "vs-dark";
}

export function FileTabs({
  tabs,
  activeTab,
  onTabSelect,
  onTabClose,
  theme = "vs-dark",
}: FileTabsProps) {
  if (tabs.length === 0) return null;

  const isDark = theme === "vs-dark";
  const containerCls = isDark
    ? "border-zinc-700/50 bg-zinc-900/80"
    : "border-zinc-200 bg-zinc-100";
  const activeCls = isDark
    ? "bg-zinc-800 text-zinc-100"
    : "bg-white text-zinc-900";
  const inactiveCls = isDark
    ? "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
    : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900";
  const borderCls = isDark ? "border-zinc-700/50" : "border-zinc-200";
  const closeBtnHover = isDark ? "hover:bg-zinc-700" : "hover:bg-zinc-300";

  return (
    <div className={`flex items-center overflow-x-auto border-b ${containerCls}`}>
      {tabs.map((tab) => {
        const isActive = tab.path === activeTab;
        return (
          <div
            key={tab.path}
            className={[
              `group flex shrink-0 items-center gap-1.5 border-r ${borderCls} px-3 py-1.5 text-xs transition-colors cursor-pointer`,
              isActive ? activeCls : inactiveCls,
            ].join(" ")}
            onClick={() => onTabSelect(tab.path)}
          >
            <span className="max-w-[120px] truncate">{tab.name}</span>
            {tab.modified && (
              <span className="h-2 w-2 rounded-full bg-amber-400" title="Unsaved changes" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.path);
              }}
              className={`ml-0.5 rounded p-0.5 opacity-0 transition-opacity ${closeBtnHover} group-hover:opacity-100`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
