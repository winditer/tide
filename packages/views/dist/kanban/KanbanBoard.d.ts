import { type DropResult } from "@hello-pangea/dnd";
import type { KanbanColumn } from "@tide/core";
interface KanbanBoardProps {
    columns: KanbanColumn[];
    onDragEnd: (result: DropResult) => void;
}
export declare function KanbanBoard({ columns, onDragEnd }: KanbanBoardProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=KanbanBoard.d.ts.map