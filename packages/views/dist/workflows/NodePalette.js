"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const ITEMS = [
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
        description: "工作流终止",
        swatch: "bg-rose-600",
    },
];
export function NodePalette({ onAddNode }) {
    const handleDragStart = (event, type) => {
        event.dataTransfer.setData("application/x-workflow-node", type);
        event.dataTransfer.setData("text/plain", type);
        event.dataTransfer.effectAllowed = "move";
    };
    return (_jsxs("div", { className: "flex h-full w-[220px] flex-col border-r border-border/50 bg-card", children: [_jsxs("div", { className: "border-b border-border/50 px-3 py-3", children: [_jsx("div", { className: "text-[10px] font-medium text-muted-foreground", children: "\u8282\u70B9\u9762\u677F" }), _jsx("div", { className: "mt-0.5 text-sm font-semibold text-foreground", children: "\u62D6\u62FD\u6DFB\u52A0" }), _jsx("div", { className: "mt-1 text-[9px] text-muted-foreground", children: "\u62D6\u62FD\u5230\u753B\u5E03\u6216\u53CC\u51FB\u6DFB\u52A0" })] }), _jsx("div", { className: "flex-1 overflow-y-auto p-2", children: ITEMS.map((item) => (_jsxs("div", { draggable: true, onDragStart: (e) => handleDragStart(e, item.type), onDoubleClick: () => onAddNode === null || onAddNode === void 0 ? void 0 : onAddNode(item.type), className: [
                        "group mb-2 cursor-grab select-none rounded-lg border border-border/50 bg-card",
                        "shadow-sm hover:shadow-card-hover transition-smooth",
                    ].join(" "), children: [_jsx("div", { className: `h-1 rounded-t-lg ${item.swatch}` }), _jsxs("div", { className: "flex items-center gap-2 px-2.5 py-2", children: [_jsx("div", { className: "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/30 text-base", children: item.icon }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "text-xs font-medium text-foreground", children: item.label }), _jsx("div", { className: "mt-0.5 truncate text-[10px] text-muted-foreground", children: item.description })] })] })] }, item.type))) }), _jsx("div", { className: "border-t border-border/50 bg-muted/30 px-3 py-2 text-[9px] leading-relaxed text-muted-foreground", children: "\u62D6\u62FD\u6216\u53CC\u51FB\u6DFB\u52A0\u8282\u70B9" })] }));
}
//# sourceMappingURL=NodePalette.js.map