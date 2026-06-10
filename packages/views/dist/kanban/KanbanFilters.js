"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { Input } from "@tide/ui";
export function KanbanFilters({ search, onSearchChange }) {
    return (_jsx("div", { className: "flex items-center gap-3", children: _jsx(Input, { placeholder: "\u641C\u7D22\u5361\u7247...", value: search, onChange: (e) => onSearchChange(e.target.value), className: "w-64" }) }));
}
//# sourceMappingURL=KanbanFilters.js.map