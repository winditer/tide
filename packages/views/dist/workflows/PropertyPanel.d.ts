import { type WorkflowNode } from "@tide/core";
interface PropertyPanelProps {
    node: WorkflowNode | null;
    onUpdate: (id: string, data: Record<string, any>) => void;
    onDelete?: (id: string) => void;
    readOnly?: boolean;
    /** 当前工作流编辑上下文的项目 ID，供审批人下拉获取项目成员使用 */
    projectId?: string;
}
export declare function PropertyPanel({ node, onUpdate, onDelete, readOnly, projectId, }: PropertyPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PropertyPanel.d.ts.map