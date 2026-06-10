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
//# sourceMappingURL=node-tones.d.ts.map