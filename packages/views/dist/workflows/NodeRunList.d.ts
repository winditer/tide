import type { WorkflowRun } from "@tide/core";
interface NodeRunListProps {
    run: WorkflowRun;
    onApprove?: (nodeId: string) => void;
    onReject?: (nodeId: string) => void;
    isPending?: boolean;
}
export declare function NodeRunList({ run, onApprove, onReject, isPending, }: NodeRunListProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=NodeRunList.d.ts.map