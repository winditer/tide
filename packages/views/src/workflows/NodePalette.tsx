"use client";

import type { WorkflowNodeType } from "@tide/core";

interface PaletteItem {
  type: WorkflowNodeType;
  label: string;
  icon: string;
  description: string;
  swatch: string;
}

const ITEMS: PaletteItem[] = [
  {
    type: "start",
    label: "Start",
    icon: "▶",
    description: "工作流入口",
    swatch: "bg-emerald-500",
  },
  {
    type: "agent",
    label: "Agent",
    icon: "🤖",
    description: "执行 AI 任务",
    swatch: "bg-primary",
  },
  {
    type: "approval",
    label: "Approval",
    icon: "🛡",
    description: "人工审批",
    swatch: "bg-violet-600",
  },
  {
    type: "condition",
    label: "Condition",
    icon: "◆",
    description: "分支判断",
    swatch: "bg-amber-500",
  },
  {
    type: "parallel",
    label: "Fork",
    icon: "＋",
    description: "并行分发",
    swatch: "bg-cyan-600",
  },
  {
    type: "parallel_join",
    label: "Join",
    icon: "－",
    description: "并行汇合",
    swatch: "bg-indigo-600",
  },
  {
    type: "delay",
    label: "Delay",
    icon: "⏱",
    description: "等待时间",
    swatch: "bg-orange-500",
  },
  {
    type: "stage",
    label: "Stage",
    icon: "✦",
    description: "工作项阶段",
    swatch: "bg-violet-500",
  },
  {
    type: "git_merge",
    label: "Git Merge",
    icon: "🔀",
    description: "分支合并",
    swatch: "bg-blue-600",
  },
  {
    type: "end",
    label: "End",
    icon: "■",
    description: "正常完成",
    swatch: "bg-rose-600",
  },
  {
    type: "cancel",
    label: "Cancel",
    icon: "⊘",
    description: "取消中止",
    swatch: "bg-amber-600",
  },
  {
    type: "error",
    label: "Error",
    icon: "✕",
    description: "错误终止",
    swatch: "bg-red-600",
  },
  {
    type: "close",
    label: "Close",
    icon: "○",
    description: "业务关闭",
    swatch: "bg-slate-600",
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
    <div className="flex h-full w-[220px] flex-col border-r border-border/50 bg-card">
      {/* Header */}
      <div className="border-b border-border/50 px-3 py-3">
        <div className="text-[10px] font-medium text-muted-foreground">
          节点面板
        </div>
        <div className="mt-0.5 text-sm font-semibold text-foreground">
          拖拽添加
        </div>
        <div className="mt-1 text-[9px] text-muted-foreground">
          拖拽到画布或双击添加
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
              "group mb-2 cursor-grab select-none rounded-lg border border-border/50 bg-card",
              "shadow-sm hover:shadow-card-hover transition-smooth",
            ].join(" ")}
          >
            {/* Top accent bar */}
            <div className={`h-1 rounded-t-lg ${item.swatch}`} />
            <div className="flex items-center gap-2 px-2.5 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/30 text-base">
                {item.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">
                  {item.label}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {item.description}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="border-t border-border/50 bg-muted/30 px-3 py-2 text-[9px] leading-relaxed text-muted-foreground">
        拖拽或双击添加节点
      </div>
    </div>
  );
}
