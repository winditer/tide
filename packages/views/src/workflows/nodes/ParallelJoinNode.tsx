"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

function ParallelJoinNodeImpl({ data, selected }: NodeProps) {
  const d = (data as any) ?? {};
  const status = d.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String(d.label ?? "Join");

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
          "h-[90px] w-[90px] border-2 bg-indigo-50",
          t.border,
          t.shadow,
        ].join(" ")}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <div
          className={`mb-1 px-2 py-[1px] font-mono text-[9px] tracking-[0.25em] ${t.accent} text-white ${t.pulse}`}
        >
          − JOIN
        </div>
        <div className="text-2xl leading-none text-indigo-700">−</div>
        <div className="mt-0.5 max-w-[140px] truncate text-[11px] font-bold text-zinc-900">
          {label}
        </div>
      </div>

      {/* Multiple target handles for converging branches */}
      <Handle
        id="i1"
        type="target"
        position={Position.Top}
        style={{ left: "20%" }}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-indigo-600"
      />
      <Handle
        id="i2"
        type="target"
        position={Position.Top}
        style={{ left: "50%" }}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-indigo-600"
      />
      <Handle
        id="i3"
        type="target"
        position={Position.Top}
        style={{ left: "80%" }}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-indigo-600"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}`}
      />
    </div>
  );
}

export const ParallelJoinNode = memo(ParallelJoinNodeImpl);
