"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

function ApprovalNodeImpl({ data, selected }: NodeProps) {
  const d = (data as any) ?? {};
  const status = d.runStatus as string | undefined;
  const t = statusTone(status);
  const label = String(d.label ?? "Approval");
  const approvers: string[] = Array.isArray(d.approvers) ? d.approvers : [];

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
        className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${t.accent}`}
      />

      <div
        className={`flex items-center justify-between px-3 py-1 bg-violet-600 text-white ${t.pulse}`}
      >
        <span className="font-mono text-[9px] tracking-[0.25em]">
          APPROVAL · {t.label}
        </span>
        <span className="font-mono text-[10px]">{t.glyph}</span>
      </div>

      <div className="relative bg-violet-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">🛡️</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-zinc-900">
              {label}
            </div>
          </div>
        </div>
        {approvers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-dashed border-violet-300 pt-2">
            {approvers.slice(0, 3).map((a) => (
              <span
                key={a}
                className="border border-violet-700 bg-white px-1.5 py-[1px] font-mono text-[9px] tracking-wider text-violet-900"
              >
                @{a}
              </span>
            ))}
            {approvers.length > 3 && (
              <span className="font-mono text-[9px] text-violet-700">
                +{approvers.length - 3}
              </span>
            )}
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

export const ApprovalNode = memo(ApprovalNodeImpl);
