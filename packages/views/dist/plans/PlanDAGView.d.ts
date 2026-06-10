import "@xyflow/react/dist/style.css";
import type { PlanDAGNode } from "@tide/core";
interface PlanDAGViewProps {
    planId: string;
    onNodeClick?: (nodeId: string, data: PlanDAGNode["data"]) => void;
    refetchInterval?: number;
}
export declare function PlanDAGView(props: PlanDAGViewProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PlanDAGView.d.ts.map