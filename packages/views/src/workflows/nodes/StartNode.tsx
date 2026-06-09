"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

function StartNodeImpl({ data, selected }: NodeProps) {
  const status = (data as any)?.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String((data as any)?.label ?? "Start");

  return (
    <div
      className={[
        "relative flex h-[88px] w-[88px] select-none items-center justify-center",
        "rounded-full border-2 bg-emerald-50",
        t.border,
        t.shadow,
        t.pulse,
        selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        "transition-transform duration-150",
      ].join(" ")}
    >
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-2xl leading-none text-emerald-700">▶</span>
        <span className="font-mono text-[9px] tracking-[0.25em] text-emerald-900">
          {label.toUpperCase().slice(0, 8)}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-emerald-700"
      />
    </div>
  );
}

export const StartNode = memo(StartNodeImpl);
