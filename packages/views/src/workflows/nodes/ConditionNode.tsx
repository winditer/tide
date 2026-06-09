"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

const OP_LABEL: Record<string, string> = {
  eq: "==",
  equals: "==",
  ne: "≠",
  not_equals: "≠",
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  contains: "⊃",
  not_contains: "⊅",
};

function ConditionNodeImpl({ data, selected }: NodeProps) {
  const d = (data as any) ?? {};
  const status = d.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String(d.label ?? "Condition");
  const field = d.field ? String(d.field) : "—";
  const operator = d.operator ? String(d.operator) : "eq";
  const value = d.value !== undefined ? String(d.value) : "—";

  return (
    <div
      className={[
        "group relative select-none",
        "transition-transform duration-150",
        selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
      ].join(" ")}
      style={{ width: 220, height: 140 }}
    >
      {/* Diamond shape via rotated square */}
      <div
        className={[
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
          "h-[110px] w-[110px] border-2 bg-amber-50",
          t.border,
          t.shadow,
        ].join(" ")}
      />
      {/* Inner content (un-rotated) */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <div
          className={`mb-1 px-2 py-[1px] font-mono text-[9px] tracking-[0.25em] ${t.accent} text-white ${t.pulse}`}
        >
          ◆ COND · {t.label}
        </div>
        <div className="text-[12px] font-bold text-zinc-900">{label}</div>
        <div className="mt-0.5 max-w-[180px] truncate font-mono text-[10px] text-amber-900">
          {field} {OP_LABEL[operator] ?? operator} {value}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Top}
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}`}
      />
      <Handle
        id="yes"
        type="source"
        position={Position.Bottom}
        style={{ left: "30%" }}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-emerald-600"
      />
      <Handle
        id="no"
        type="source"
        position={Position.Bottom}
        style={{ left: "70%" }}
        className="!h-2.5 !w-2.5 !rounded-none !border-0 !bg-rose-600"
      />
      {/* Branch labels */}
      <div className="pointer-events-none absolute bottom-[-2px] left-[20%] font-mono text-[9px] tracking-widest text-emerald-700">
        YES
      </div>
      <div className="pointer-events-none absolute bottom-[-2px] right-[20%] font-mono text-[9px] tracking-widest text-rose-700">
        NO
      </div>
    </div>
  );
}

export const ConditionNode = memo(ConditionNodeImpl);
