import type { WorkflowNodeRunStatus } from "@tide/core";

export interface NodeTone {
  ring: string;
  surface: string;
  accent: string;
  pulse: string;
  label: string;
  glyph: string;
  border: string;
  shadow: string;
}

const STATUS_TONES: Record<string, NodeTone> = {
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
export function statusTone(
  status: WorkflowNodeRunStatus | string | undefined | null
): NodeTone {
  if (!status) return STATUS_TONES.idle;
  return STATUS_TONES[status] ?? STATUS_TONES.idle;
}

export const STATUS_BG: Record<string, string> = {
  pending: "bg-zinc-200",
  running: "bg-sky-200",
  completed: "bg-emerald-200",
  failed: "bg-rose-200",
  skipped: "bg-zinc-100",
  cancelled: "bg-zinc-300",
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  skipped: "已跳过",
  cancelled: "已取消",
};

// ---------- Stage 节点：按 category 区分视觉 ----------

export interface StageCategoryTone {
  /** 顶部条带 / 箭头连接器底色 */
  accent: string;
  /** 节点正文表面色 */
  surface: string;
  /** 图标方块 / 装饰柱填充 */
  swatch: string;
  /** 中文展示名 */
  label: string;
}

const STAGE_CATEGORY_TONES: Record<string, StageCategoryTone> = {
  todo: {
    accent: "bg-zinc-700",
    surface: "bg-zinc-50",
    swatch: "bg-zinc-700",
    label: "待办",
  },
  in_progress: {
    accent: "bg-sky-600",
    surface: "bg-sky-50",
    swatch: "bg-sky-600",
    label: "进行中",
  },
  review: {
    accent: "bg-amber-500",
    surface: "bg-amber-50",
    swatch: "bg-amber-500",
    label: "评审",
  },
  done: {
    accent: "bg-emerald-600",
    surface: "bg-emerald-50",
    swatch: "bg-emerald-600",
    label: "已完成",
  },
  custom: {
    accent: "bg-violet-600",
    surface: "bg-violet-50",
    swatch: "bg-violet-600",
    label: "自定义",
  },
};

/** 根据 stage 节点 category 返回视觉色调；未知 category 回退为 custom。 */
export function stageCategoryTone(category?: string | null): StageCategoryTone {
  if (!category) return STAGE_CATEGORY_TONES.custom;
  return STAGE_CATEGORY_TONES[category] ?? STAGE_CATEGORY_TONES.custom;
}

export const STAGE_CATEGORY_OPTIONS: Array<{
  label: string;
  value: string;
}> = [
  { label: "待办 (TODO)", value: "todo" },
  { label: "进行中 (IN PROGRESS)", value: "in_progress" },
  { label: "评审 (REVIEW)", value: "review" },
  { label: "已完成 (DONE)", value: "done" },
  { label: "自定义 (CUSTOM)", value: "custom" },
];
