const STATUS_TONES = {
    idle: {
        ring: "ring-zinc-300",
        surface: "bg-white",
        accent: "bg-zinc-900",
        pulse: "",
        label: "IDLE",
        glyph: "◇",
        border: "border-zinc-900",
        shadow: "shadow-[5px_5px_0_0_rgba(24,24,27,0.92)]",
    },
    pending: {
        ring: "ring-zinc-300",
        surface: "bg-zinc-50",
        accent: "bg-zinc-500",
        pulse: "",
        label: "PENDING",
        glyph: "◇",
        border: "border-zinc-900",
        shadow: "shadow-[5px_5px_0_0_rgba(24,24,27,0.92)]",
    },
    running: {
        ring: "ring-sky-400",
        surface: "bg-sky-50",
        accent: "bg-sky-500",
        pulse: "animate-pulse",
        label: "RUNNING",
        glyph: "▲",
        border: "border-sky-700",
        shadow: "shadow-[5px_5px_0_0_rgba(2,132,199,0.92)]",
    },
    completed: {
        ring: "ring-emerald-500",
        surface: "bg-emerald-50",
        accent: "bg-emerald-600",
        pulse: "",
        label: "DONE",
        glyph: "■",
        border: "border-emerald-700",
        shadow: "shadow-[5px_5px_0_0_rgba(4,120,87,0.92)]",
    },
    failed: {
        ring: "ring-rose-500",
        surface: "bg-rose-50",
        accent: "bg-rose-600",
        pulse: "",
        label: "FAILED",
        glyph: "✕",
        border: "border-rose-700",
        shadow: "shadow-[5px_5px_0_0_rgba(190,18,60,0.92)]",
    },
    skipped: {
        ring: "ring-zinc-300",
        surface: "bg-white",
        accent: "bg-zinc-400",
        pulse: "",
        label: "SKIPPED",
        glyph: "—",
        border: "border-zinc-400 border-dashed",
        shadow: "",
    },
};
/**
 * Resolve presentation tone from a node run status (or undefined for idle/edit mode).
 */
export function statusTone(status) {
    var _a;
    if (!status)
        return STATUS_TONES.idle;
    return (_a = STATUS_TONES[status]) !== null && _a !== void 0 ? _a : STATUS_TONES.idle;
}
export const STATUS_BG = {
    pending: "bg-zinc-200",
    running: "bg-sky-200",
    completed: "bg-emerald-200",
    failed: "bg-rose-200",
    skipped: "bg-zinc-100",
    cancelled: "bg-zinc-300",
};
export const STATUS_LABEL = {
    pending: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    skipped: "已跳过",
    cancelled: "已取消",
};
//# sourceMappingURL=node-tones.js.map