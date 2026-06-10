import "@xyflow/react/dist/style.css";
import type { WorkflowDefinition, WorkflowNodeRun } from "@tide/core";
export interface WorkflowCanvasProps {
    definition: WorkflowDefinition;
    /** When provided, switches into runtime / read-only mode and color nodes by status. */
    nodeRuns?: WorkflowNodeRun[];
    readOnly?: boolean;
    onChange?: (def: WorkflowDefinition) => void;
    onSave?: (def: WorkflowDefinition) => void;
    onRun?: () => void;
    isSaving?: boolean;
    isRunning?: boolean;
    /** Optional toolbar-right slot (for custom actions like cancel run) */
    toolbarExtra?: React.ReactNode;
    /** Sub-title shown in the canvas chrome */
    subtitle?: string;
}
export declare function WorkflowCanvas(props: WorkflowCanvasProps): import("react").JSX.Element;
//# sourceMappingURL=WorkflowCanvas.d.ts.map