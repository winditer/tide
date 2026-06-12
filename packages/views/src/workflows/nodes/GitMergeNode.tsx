"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

function GitMergeNodeImpl({ data, selected }: NodeProps) {
  const d = (data as any) ?? {};
  const status = d.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String(d.label ?? "Git Merge");
  const targetBranch = d.targetBranch ? String(d.targetBranch) : null;
  const mergeStrategy = d.mergeStrategy ? String(d.mergeStrategy) : null;

  return (
    <div
      className={[
        "group relative w-[240px] select-none border-2 bg-white",
        t.border,
        t.shadow,
        "transition-transform duration-150",
        selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}`}
      />

      {/* Status stripe */}
      <div
        className={`flex items-center justify-between px-3 py-1 bg-blue-600 text-white ${t.pulse}`}
      >
        <span className="font-mono text-[9px] tracking-[0.25em]">
          GIT MERGE · {t.label}
        </span>
        <span className="font-mono text-[10px]">{t.glyph}</span>
      </div>

      {/* Body */}
      <div className={`relative px-3 py-2.5 ${t.surface}`}>
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-900 bg-white">
            <span className="text-base">🔀</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-zinc-900">
              {label}
            </div>
            {targetBranch && (
              <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                → {targetBranch}
              </div>
            )}
          </div>
        </div>
        {mergeStrategy && (
          <div className="mt-2 border-t border-dashed border-zinc-300 pt-2 font-mono text-[10px] leading-relaxed text-zinc-600">
            策略: {mergeStrategy}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}`}
      />
    </div>
  );
}

export const GitMergeNode = memo(GitMergeNodeImpl);
