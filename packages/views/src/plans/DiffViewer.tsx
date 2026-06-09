"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePlanTasks } from "@lark2codex/core";
import { useTaskQuery } from "@lark2codex/core";

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  { ssr: false, loading: () => <DiffSkeleton /> }
);

interface DiffViewerProps {
  planId: string;
}

function DiffSkeleton() {
  return (
    <div className="flex h-full items-center justify-center font-mono text-xs tracking-widest text-zinc-500">
      ◐ LOADING MONACO…
    </div>
  );
}

interface ParsedDiff {
  original: string;
  modified: string;
  language: string;
}

// Parse diff_summary - support unified diff or raw text
function parseDiff(raw: string | null | undefined): ParsedDiff {
  if (!raw) return { original: "", modified: "", language: "plaintext" };

  // Try parsing as JSON first
  try {
    const obj = JSON.parse(raw);
    if (typeof obj === "object" && obj !== null) {
      if ("original" in obj && "modified" in obj) {
        return {
          original: String(obj.original ?? ""),
          modified: String(obj.modified ?? ""),
          language: String(obj.language ?? "plaintext"),
        };
      }
    }
  } catch {
    // not JSON
  }

  // Treat as unified diff: split by lines, "-" goes to original, "+" goes to modified
  const lines = raw.split("\n");
  const original: string[] = [];
  const modified: string[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (!inHunk) {
      // Not a unified diff: show raw on right side
      return {
        original: "",
        modified: raw,
        language: "plaintext",
      };
    }
    if (line.startsWith("-")) original.push(line.slice(1));
    else if (line.startsWith("+")) modified.push(line.slice(1));
    else if (line.startsWith(" ")) {
      original.push(line.slice(1));
      modified.push(line.slice(1));
    }
  }

  return {
    original: original.join("\n"),
    modified: modified.join("\n"),
    language: "plaintext",
  };
}

export function DiffViewer({ planId }: DiffViewerProps) {
  const { data: tasks, isLoading } = usePlanTasks(planId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const tasksWithDiff = tasks ?? [];
  const activeId = selectedTaskId ?? tasksWithDiff[0]?.task_id ?? null;

  const { data: activeTask } = useTaskQuery(activeId ?? "");

  const parsed = useMemo(
    () => parseDiff(activeTask?.diff_summary),
    [activeTask?.diff_summary]
  );

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center font-mono text-xs tracking-widest text-zinc-500">
        ◐ LOADING TASKS…
      </div>
    );
  }

  if (tasksWithDiff.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center border border-zinc-900 bg-white font-mono text-xs tracking-widest text-zinc-500">
        ◇ NO TASKS IN THIS PLAN
      </div>
    );
  }

  return (
    <div className="border border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-900 bg-zinc-950 px-4 py-2 text-white">
        <span className="font-mono text-[10px] tracking-[0.3em]">
          DIFF · MONACO
        </span>
        <span className="font-mono text-[10px] tracking-widest text-zinc-400">
          {tasksWithDiff.length} TASK
          {tasksWithDiff.length !== 1 ? "S" : ""}
        </span>
      </div>

      <div className="grid grid-cols-[260px_1fr]">
        {/* Sidebar: task picker */}
        <div className="border-r border-dashed border-zinc-300">
          <div className="border-b border-dashed border-zinc-300 px-4 py-2 font-mono text-[10px] tracking-widest text-zinc-500">
            TASKS
          </div>
          <div className="max-h-[600px] overflow-auto">
            {tasksWithDiff.map((t) => {
              const active = t.task_id === activeId;
              return (
                <button
                  key={t.task_id}
                  onClick={() => setSelectedTaskId(t.task_id)}
                  className={[
                    "flex w-full items-center gap-2 border-b border-dashed border-zinc-200 px-4 py-2 text-left transition-colors",
                    active
                      ? "bg-zinc-900 text-white"
                      : "hover:bg-zinc-50",
                  ].join(" ")}
                >
                  <span
                    className={`font-mono text-[10px] ${active ? "text-zinc-300" : "text-zinc-400"}`}
                  >
                    #{String(t.task_index).padStart(2, "0")}
                  </span>
                  <span className="truncate text-[12px] font-medium">
                    {t.title || t.task_id.slice(0, 8)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Diff panel */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-dashed border-zinc-300 px-4 py-2">
            <span className="truncate font-mono text-[11px] text-zinc-700">
              {activeTask?.prompt?.slice(0, 80) ?? "—"}
            </span>
            {!activeTask?.diff_summary && (
              <span className="ml-2 shrink-0 font-mono text-[10px] tracking-widest text-zinc-400">
                ◇ NO DIFF
              </span>
            )}
          </div>
          <div style={{ height: 560 }}>
            {activeTask?.diff_summary ? (
              <MonacoDiffEditor
                height="100%"
                original={parsed.original}
                modified={parsed.modified}
                language={parsed.language}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  renderWhitespace: "boundary",
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-xs tracking-widest text-zinc-400">
                ◇ THIS TASK HAS NO DIFF SUMMARY
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
