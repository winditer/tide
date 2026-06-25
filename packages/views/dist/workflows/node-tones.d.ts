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
/**
 * Resolve presentation tone from a node run status (or undefined for idle/edit mode).
 */
export declare function statusTone(status: WorkflowNodeRunStatus | string | undefined | null): NodeTone;
export declare const STATUS_BG: Record<string, string>;
export declare const STATUS_LABEL: Record<string, string>;
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
/** 根据 stage 节点 category 返回视觉色调；未知 category 回退为 custom。 */
export declare function stageCategoryTone(category?: string | null): StageCategoryTone;
export declare const STAGE_CATEGORY_OPTIONS: Array<{
    label: string;
    value: string;
}>;
//# sourceMappingURL=node-tones.d.ts.map