"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const ITEMS = [
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
export function NodePalette({ onAddNode }) {
    const handleDragStart = (event, type) => {
        event.dataTransfer.setData("application/x-workflow-node", type);
        event.dataTransfer.setData("text/plain", type);
        event.dataTransfer.effectAllowed = "move";
    };
    return (_jsxs("div", { className: "flex h-full w-[220px] flex-col border-r-2 border-zinc-900 bg-white", children: [_jsxs("div", { className: "border-b-2 border-zinc-900 bg-zinc-950 px-3 py-3 text-white", children: [_jsx("div", { className: "font-mono text-[10px] tracking-[0.3em] text-zinc-400", children: "NODE" }), _jsx("div", { className: "mt-0.5 font-mono text-[13px] font-bold tracking-[0.2em]", children: "\u25F3 PALETTE" }), _jsx("div", { className: "mt-1 font-mono text-[9px] tracking-widest text-zinc-500", children: "DRAG \u2192 CANVAS" })] }), _jsx("div", { className: "flex-1 overflow-y-auto p-2", children: ITEMS.map((item) => (_jsxs("div", { draggable: true, onDragStart: (e) => handleDragStart(e, item.type), onDoubleClick: () => onAddNode === null || onAddNode === void 0 ? void 0 : onAddNode(item.type), className: [
                        "group mb-2 cursor-grab select-none border border-zinc-900 bg-white",
                        "shadow-[3px_3px_0_0_rgba(24,24,27,0.92)]",
                        "transition-all duration-150",
                        "hover:translate-x-[-1px] hover:translate-y-[-1px]",
                        "hover:shadow-[4px_4px_0_0_rgba(24,24,27,0.92)]",
                        "active:translate-x-[1px] active:translate-y-[1px]",
                        "active:shadow-[2px_2px_0_0_rgba(24,24,27,0.92)]",
                    ].join(" "), children: [_jsx("div", { className: `h-1 ${item.swatch}` }), _jsxs("div", { className: "flex items-center gap-2 px-2.5 py-2", children: [_jsx("div", { className: "flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-900 bg-zinc-50 text-base", children: item.icon }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "font-mono text-[9px] tracking-[0.2em] text-zinc-500", children: item.glyph }), _jsx("span", { className: "text-[12px] font-bold text-zinc-900", children: item.label })] }), _jsx("div", { className: "mt-0.5 truncate text-[10px] text-zinc-500", children: item.description })] })] })] }, item.type))) }), _jsx("div", { className: "border-t border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[9px] leading-relaxed tracking-wider text-zinc-500", children: "\u25C7 DRAG OR DOUBLE-CLICK TO ADD" })] }));
}
//# sourceMappingURL=NodePalette.js.map