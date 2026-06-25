import type { WorkItem } from "@tide/core";
interface WorkItemCardProps {
    item: WorkItem;
    index: number;
    onClick?: (item: WorkItem) => void;
    /** 在 end 节点列下的卡片：只读、不可拖动、带完成视觉样式 */
    completed?: boolean;
    /** 版本 id -> 版本名称 映射，用于渲染版本标签 */
    versionMap?: Record<string, string>;
    /** 是否禁用拖拽（如泳道分组模式下） */
    draggable?: boolean;
}
export declare function WorkItemCard({ item, index, onClick, completed, versionMap, draggable, }: WorkItemCardProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=WorkItemCard.d.ts.map