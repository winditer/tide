import type { WorkflowNode } from "@tide/core";
interface PropertyPanelProps {
    node: WorkflowNode | null;
    onUpdate: (id: string, data: Record<string, any>) => void;
    onDelete?: (id: string) => void;
    readOnly?: boolean;
}
export declare function PropertyPanel({ node, onUpdate, onDelete, readOnly, }: PropertyPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PropertyPanel.d.ts.map