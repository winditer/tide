import { type WorkItem, type WorkItemFilters } from "@tide/core";
interface WorkItemListViewProps {
    projectId: string;
    filters?: WorkItemFilters;
    onItemClick?: (item: WorkItem) => void;
}
export declare function WorkItemListView({ projectId, filters, onItemClick }: WorkItemListViewProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=WorkItemListView.d.ts.map