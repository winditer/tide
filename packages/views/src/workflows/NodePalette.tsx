"use client";

import type { WorkflowNodeType } from "@lark2codex/core";

interface PaletteItem {
  type: WorkflowNodeType;
  label: string;
  icon: string;
  glyph: string;
  description: string;
  swatch: string;
}

const ITEMS: PaletteItem[] = [
  {
    type: "start",
    label: "Start",
    icon: "▶",
    glyph: "○",
    description: "工作流入口",
    swatch: "bg-emerald-500",
  },
  {
    type: "agent",
    label: "Agent",
    icon: "🤖",
    glyph: "◰",
    description: "执行 AI 任务",
    swatch: "bg-zinc-900",
  },
  {
    type: "approval",
    label: "Approval",
    icon: "🛡",
    glyph: "◫",
    description: "人工审批",
    swatch: "bg-violet-600",
  },
  {
    type: "condition",
    label: "Condition",
    icon: "◆",
    glyph: "◆",
    description: "分支判断",
    swatch: "bg-amber-500",
  },
  {
    type: "parallel",
    label: "Fork",
    icon: "＋",
    glyph: "✚",
    description: "并行分发",
    swatch: "bg-cyan-600",
  },
  {
    type: "parallel_join",
    label: "Join",
    icon: "－",
    glyph: "—",
    description: "并行汇合",
    swatch: "bg-indigo-600",
  },
  {
    type: "delay",
    label: "Delay",
    icon: "⏱",
    glyph: "≡",
    description: "等待时间",
    swatch: "bg-orange-500",
  },
  {
    type: "end",
    label: "End",
    icon: "■",
    glyph: "●",
    description: "工作流终止",
    swatch: "bg-rose-600",
  },
];

interface NodePaletteProps {
  onAddNode?: (type: WorkflowNodeType) => void;
}

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const handleDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    type: WorkflowNodeType
  ) => {
    event.dataTransfer.setData("application/x-workflow-node", type);
    event.dataTransfer.setData("text/plain", type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="flex h-full w-[220px] flex-col border-r-2 border-zinc-900 bg-white">
      {/* Header */}
      <div className="border-b-2 border-zinc-900 bg-zinc-950 px-3 py-3 text-white">
        <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
          NODE
        </div>
        <div className="mt-0.5 font-mono text-[13px] font-bold tracking-[0.2em]">
          ◳ PALETTE
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-widest text-zinc-500">
          DRAG → CANVAS
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-2">
        {ITEMS.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => handleDragStart(e, item.type)}
            onDoubleClick={() => onAddNode?.(item.type)}
            className={[
              "group mb-2 cursor-grab select-none border border-zinc-900 bg-white",
              "shadow-[3px_3px_0_0_rgba(24,24,27,0.92)]",
              "transition-all duration-150",
              "hover:translate-x-[-1px] hover:translate-y-[-1px]",
              "hover:shadow-[4px_4px_0_0_rgba(24,24,27,0.92)]",
              "active:translate-x-[1px] active:translate-y-[1px]",
              "active:shadow-[2px_2px_0_0_rgba(24,24,27,0.92)]",
            ].join(" ")}
          >
            {/* Top accent bar */}
            <div className={`h-1 ${item.swatch}`} />
            <div className="flex items-center gap-2 px-2.5 py-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-900 bg-zinc-50 text-base">
                {item.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[9px] tracking-[0.2em] text-zinc-500">
                    {item.glyph}
                  </span>
                  <span className="text-[12px] font-bold text-zinc-900">
                    {item.label}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                  {item.description}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="border-t border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[9px] leading-relaxed tracking-wider text-zinc-500">
        ◇ DRAG OR DOUBLE-CLICK TO ADD
      </div>
    </div>
  );
}
