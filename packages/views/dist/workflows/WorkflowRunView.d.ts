import type { WorkflowDefinition, WorkflowRun } from "@tide/core";
interface WorkflowRunViewProps {
    definition: WorkflowDefinition;
    run: WorkflowRun;
    subtitle?: string;
    toolbarExtra?: React.ReactNode;
}
export declare function WorkflowRunView({ definition, run, subtitle, toolbarExtra, }: WorkflowRunViewProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=WorkflowRunView.d.ts.map