"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

function ParallelNodeImpl({ data, selected }: NodeProps) {
  const d = (data as any) ?? {};
  const status = d.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String(d.label ?? "Fork");

  return (
    <div
      className={[
        "group relative select-none",
        "transition-transform duration-150",
        selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
      ].join(" ")}
      style={{ width: 200, height: 120 }}
    >
      <div
        className={[
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
          "h-[90px] w-[90px] border-2 bg-cyan-50",
          t.border,
          t.shadow,
        ].join(" ")}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <div
          className={`mb-1 px-2 py-[1px] font-mono text-[9px] tracking-[0.25em] ${t.accent} text-white ${t.pulse}`}
        >
          + FORK
        </div>
        <div className="text-2xl leading-none text-cyan-700">＋</div>
        <div className="mt-0.5 max-w-[140px] truncate text-[11px] font-bold text-zinc-900">
          {label}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Top}
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}`}
      />
      {/* Three parallel branches */}
      <Handle
        id="b1"
        type="source"
        position={Position.Bottom}
        style={{ left: "20%" }}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-cyan-600"
      />
      <Handle
        id="b2"
        type="source"
        position={Position.Bottom}
        style={{ left: "50%" }}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-cyan-600"
      />
      <Handle
        id="b3"
        type="source"
        position={Position.Bottom}
        style={{ left: "80%" }}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-cyan-600"
      />
    </div>
  );
}

export const ParallelNode = memo(ParallelNodeImpl);
