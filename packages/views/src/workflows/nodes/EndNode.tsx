"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

function EndNodeImpl({ data, selected }: NodeProps) {
  const status = (data as any)?.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String((data as any)?.label ?? "End");

  return (
    <div
      className={[
        "relative flex h-[88px] w-[88px] select-none items-center justify-center",
        "rounded-full border-2 bg-rose-50",
        t.border,
        t.shadow,
        selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        "transition-transform duration-150",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-rose-700"
      />
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-2xl leading-none text-rose-700">■</span>
        <span className="font-mono text-[9px] tracking-[0.25em] text-rose-900">
          {label.toUpperCase().slice(0, 8)}
        </span>
      </div>
    </div>
  );
}

export const EndNode = memo(EndNodeImpl);
