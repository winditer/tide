"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PlanDAGNodeData } from "@lark2codex/core";

const STATUS_TONE: Record<
  string,
  {
    ring: string;
    surface: string;
    accent: string;
    pulse: string;
    label: string;
    glyph: string;
  }
> = {
  queued: {
    ring: "ring-slate-300",
    surface: "bg-white",
    accent: "bg-slate-400",
    pulse: "",
    label: "QUEUED",
    glyph: "◇",
  },
  running: {
    ring: "ring-amber-400",
    surface: "bg-amber-50",
    accent: "bg-amber-500",
    pulse: "animate-pulse",
    label: "RUNNING",
    glyph: "▲",
  },
  review: {
    ring: "ring-violet-400",
    surface: "bg-violet-50",
    accent: "bg-violet-500",
    pulse: "",
    label: "REVIEW",
    glyph: "◑",
  },
  approved: {
    ring: "ring-emerald-400",
    surface: "bg-emerald-50",
    accent: "bg-emerald-500",
    pulse: "",
    label: "APPROVED",
    glyph: "✓",
  },
  completed: {
    ring: "ring-emerald-500",
    surface: "bg-emerald-50",
    accent: "bg-emerald-600",
    pulse: "",
    label: "DONE",
    glyph: "■",
  },
  failed: {
    ring: "ring-rose-500",
    surface: "bg-rose-50",
    accent: "bg-rose-600",
    pulse: "",
    label: "FAILED",
    glyph: "✕",
  },
  rejected: {
    ring: "ring-rose-400",
    surface: "bg-rose-50",
    accent: "bg-rose-500",
    pulse: "",
    label: "REJECTED",
    glyph: "✕",
  },
  stopped: {
    ring: "ring-zinc-400",
    surface: "bg-zinc-50",
    accent: "bg-zinc-500",
    pulse: "",
    label: "STOPPED",
    glyph: "□",
  },
  cancelled: {
    ring: "ring-zinc-400",
    surface: "bg-zinc-50",
    accent: "bg-zinc-500",
    pulse: "",
    label: "CANCELLED",
    glyph: "□",
  },
};

function tone(status: string) {
  return STATUS_TONE[status] ?? STATUS_TONE.queued;
}

function PlanTaskNodeImpl({ data, selected }: NodeProps) {
  const d = (data ?? {}) as unknown as PlanDAGNodeData;
  const t = tone(String(d.status));
  const idx = d.taskIndex ?? d.task_index;
  const phase = d.phase ?? 0;
  const agent = d.agentId ?? d.agent_id;

  return (
    <div
      className={[
        "group relative w-[260px] select-none",
        "border border-zinc-900",
        "bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]",
        "transition-transform duration-150",
        selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
      ].join(" ")}
    >
      {/* Top status stripe */}
      <div
        className={`flex items-center justify-between px-3 py-1.5 ${t.accent} text-white ${t.pulse}`}
      >
        <span className="font-mono text-[10px] tracking-[0.2em]">
          {t.label}
        </span>
        <span className="font-mono text-[11px]">{t.glyph}</span>
      </div>

      {/* Body */}
      <div className={`relative px-4 py-3 ${t.surface}`}>
        {/* Index badge */}
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-widest text-zinc-500">
            {idx != null
              ? `#${String(idx).padStart(2, "0")}`
              : "#--"}
            <span className="mx-1.5 text-zinc-300">/</span>
            <span className="text-zinc-700">PHASE {phase}</span>
          </span>
          {agent && (
            <span className="rounded-sm border border-zinc-300 bg-white px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-zinc-700">
              {agent}
            </span>
          )}
        </div>

        {/* Title */}
        <div className="text-[13px] font-semibold leading-snug text-zinc-900 line-clamp-3">
          {d.title || "Untitled"}
        </div>

        {/* Hover hint */}
        <div className="mt-2 font-mono text-[9px] tracking-widest text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100">
          → CLICK TO INSPECT
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className={`!h-2 !w-2 !rounded-none !border-0 ${t.accent}`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className={`!h-2 !w-2 !rounded-none !border-0 ${t.accent}`}
      />
    </div>
  );
}

export const PlanTaskNode = memo(PlanTaskNodeImpl);
