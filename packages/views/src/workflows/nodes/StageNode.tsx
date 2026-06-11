"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { stageCategoryTone, statusTone } from "../node-tones";

const CATEGORY_LABEL: Record<string, string> = {
  todo: "TODO",
  in_progress: "IN-PROGRESS",
  review: "REVIEW",
  done: "DONE",
  custom: "CUSTOM",
};

const CATEGORY_GLYPH: Record<string, string> = {
  todo: "◇",
  in_progress: "▣",
  review: "◉",
  done: "■",
  custom: "◆",
};

function StageNodeImpl({ data, selected }: NodeProps) {
  const d = (data as any) ?? {};
  const status = d.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String(d.label ?? "Stage");
  const category = String(d.category ?? "todo");
  const cat = stageCategoryTone(category);
  const wipCount =
    typeof d.wip_count === "number" ? (d.wip_count as number) : null;

  return (
    <div
      className={[
        "group relative w-[220px] select-none border-2 bg-white",
        t.border,
        t.shadow,
        "transition-transform duration-150",
        selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${cat.accent}`}
      />

      {/* Status stripe (driven by category) */}
      <div
        className={`flex items-center justify-between px-3 py-1 ${cat.accent} text-white ${t.pulse}`}
      >
        <span className="font-mono text-[9px] tracking-[0.25em]">
          STAGE · {CATEGORY_LABEL[category] ?? category.toUpperCase()}
        </span>
        <span className="font-mono text-[10px]">
          {CATEGORY_GLYPH[category] ?? "◆"}
        </span>
      </div>

      {/* Body */}
      <div className={`relative px-3 py-2.5 ${cat.surface}`}>
        <div className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-900 ${cat.swatch} text-white`}
          >
            <span className="font-mono text-[11px]">
              {CATEGORY_GLYPH[category] ?? "◆"}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-zinc-900">
              {label}
            </div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-600">
              {CATEGORY_LABEL[category] ?? category}
            </div>
          </div>
          {wipCount !== null && (
            <div
              className={`shrink-0 border-2 border-zinc-900 ${cat.surface} px-1.5 py-[1px] font-mono text-[10px] font-bold tabular-nums text-zinc-900`}
            >
              {wipCount}
            </div>
          )}
        </div>

        {/* Decorative ticks – brutalist column rail */}
        <div className="mt-2 flex items-center gap-[3px] border-t border-dashed border-zinc-300 pt-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`h-[6px] w-[6px] ${
                i < 4 ? cat.swatch : "bg-zinc-200"
              }`}
            />
          ))}
          <span className="ml-auto font-mono text-[9px] tracking-widest text-zinc-500">
            COL · {category.toUpperCase().slice(0, 4)}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${cat.accent}`}
      />
    </div>
  );
}

export const StageNode = memo(StageNodeImpl);
