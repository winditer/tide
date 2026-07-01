"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { statusTone } from "../node-tones";

interface TerminalConfig {
  icon: string;
  bgClass: string;
  accentClass: string;
  textClass: string;
}

const TERMINAL_CONFIGS: Record<string, TerminalConfig> = {
  end:    { icon: "■", bgClass: "bg-rose-50",  accentClass: "!bg-rose-700",  textClass: "text-rose-900" },
  cancel: { icon: "⊘", bgClass: "bg-amber-50", accentClass: "!bg-amber-600", textClass: "text-amber-900" },
  error:  { icon: "✕", bgClass: "bg-red-50",   accentClass: "!bg-red-600",   textClass: "text-red-900" },
  close:  { icon: "○", bgClass: "bg-slate-50", accentClass: "!bg-slate-600", textClass: "text-slate-900" },
};

export function createTerminalNode(terminalType: string) {
  const cfg = TERMINAL_CONFIGS[terminalType] || TERMINAL_CONFIGS.end;

  function TerminalNodeImpl({ data, selected }: NodeProps) {
    const status = (data as any)?.runStatus as string | undefined;
    const t = statusTone(status);
    const label = String((data as any)?.label ?? terminalType);

    return (
      <div
        className={[
          "relative flex h-[88px] w-[88px] select-none items-center justify-center",
          "rounded-full border-2",
          cfg.bgClass,
          t.border,
          t.shadow,
          selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
          "transition-transform duration-150",
        ].join(" ")}
      >
        <Handle
          type="target"
          position={Position.Top}
          className={`!h-2.5 !w-2.5 !rounded-none !border-0 ${cfg.accentClass}`}
        />
        <div className="flex flex-col items-center gap-0.5">
          <span className={`text-2xl leading-none ${cfg.textClass}`}>
            {cfg.icon}
          </span>
          <span
            className={`font-mono text-[9px] tracking-[0.25em] ${cfg.textClass}`}
          >
            {label.toUpperCase().slice(0, 8)}
          </span>
        </div>
      </div>
    );
  }

  return memo(TerminalNodeImpl);
}

// 预创建的终态节点组件
export const EndNode = createTerminalNode("end");
export const CancelNode = createTerminalNode("cancel");
export const ErrorNode = createTerminalNode("error");
export const CloseNode = createTerminalNode("close");
