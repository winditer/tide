import { type WorkItem } from "@tide/core";
export type WorkItemGroupBy = "none" | "assignee" | "priority" | "version";
interface WorkItemBoardProps {
    projectId: string;
    versionId?: string;
    onCardClick?: (item: WorkItem) => void;
    /** 版本 id -> 版本名称 映射，用于卡片版本徽标与按版本分组 */
    versionMap?: Record<string, string>;
    /** 泳道分组方式，默认 none */
    groupBy?: WorkItemGroupBy;
    /** 自动刷新间隔（毫秒），0 表示关闭自动刷新，未传则使用 hook 默认值 */
    refetchInterval?: number;
}
export declare function WorkItemBoard({ projectId, versionId, onCardClick, versionMap, groupBy, refetchInterval, }: WorkItemBoardProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=WorkItemBoard.d.ts.map