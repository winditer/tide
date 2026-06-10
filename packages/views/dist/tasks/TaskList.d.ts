import type { Task } from "@tide/core";
interface TaskListProps {
    items: Task[];
    total: number;
    page: number;
    pageSize: number;
    onPageChange: (page: number) => void;
}
export declare function TaskList({ items, total, page, pageSize, onPageChange, }: TaskListProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=TaskList.d.ts.map