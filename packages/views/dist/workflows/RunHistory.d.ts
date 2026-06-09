import type { WorkflowRun } from "@lark2codex/core";
interface RunHistoryProps {
    workflowId: string;
    runs: WorkflowRun[];
    isLoading?: boolean;
}
export declare function RunHistory({ workflowId, runs, isLoading }: RunHistoryProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=RunHistory.d.ts.map