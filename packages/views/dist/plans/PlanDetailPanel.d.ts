import type { PlanDAGNodeData } from "@tide/core";
interface PlanDetailPanelProps {
    taskId: string | null;
    nodeData?: PlanDAGNodeData | null;
    open: boolean;
    onClose: () => void;
}
export declare function PlanDetailPanel({ taskId, nodeData, open, onClose, }: PlanDetailPanelProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=PlanDetailPanel.d.ts.map