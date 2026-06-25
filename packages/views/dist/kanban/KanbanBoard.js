"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { DragDropContext } from "@hello-pangea/dnd";
import { BoardColumn } from "./BoardColumn";
export function KanbanBoard({ columns, onDragEnd }) {
    // 防御性兜底：确保即使上游传入 undefined / 非数组（例如直接把后端原始响应透传过来）也不会崩溃
    const safeColumns = Array.isArray(columns)
        ? columns
        : Array.isArray(columns === null || columns === void 0 ? void 0 : columns.columns)
            ? columns.columns
            : [];
    return (_jsx(DragDropContext, { onDragEnd: onDragEnd, children: _jsx("div", { className: "flex gap-5 overflow-x-auto pb-4", children: safeColumns.map((column) => (_jsx(BoardColumn, { column: column }, column.id))) }) }));
}
//# sourceMappingURL=KanbanBoard.js.map