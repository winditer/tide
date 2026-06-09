"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0s";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function DelayNodeImpl({ data, selected }: NodeProps) {
  const d = (data as any) ?? {};
  const status = d.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String(d.label ?? "Delay");
  const seconds = Number(d.seconds ?? 0);

  return (
    <div
      className={[
        "group relative w-[200px] select-none border-2 bg-white",
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

      <div
        className={`flex items-center justify-between px-3 py-1 bg-orange-500 text-white ${t.pulse}`}
      >
        <span className="font-mono text-[9px] tracking-[0.25em]">
          DELAY · {t.label}
        </span>
        <span className="font-mono text-[10px]">{t.glyph}</span>
      </div>

      <div className="bg-orange-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">⏱</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-zinc-900">
              {label}
            </div>
            <div className="font-mono text-[11px] text-orange-900">
              ≡ {formatSeconds(seconds)}
            </div>
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}`}
      />
    </div>
  );
}

export const DelayNode = memo(DelayNodeImpl);
