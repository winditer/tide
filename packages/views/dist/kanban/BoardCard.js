"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "@lark2codex/ui";
import { Draggable } from "@hello-pangea/dnd";
const STATUS_VARIANT = {
    queued: "secondary",
    running: "default",
    active: "default",
    completed: "secondary",
    failed: "destructive",
    stopped: "outline",
    idle: "outline",
    archived: "outline",
};
function formatTime(iso) {
    if (!iso)
        return "";
    try {
        return new Date(iso).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    catch (_a) {
        return iso;
    }
}
export function BoardCard({ card, index }) {
    return (_jsx(Draggable, { draggableId: card.id, index: index, children: (provided, snapshot) => {
            var _a, _b;
            return (_jsxs("div", Object.assign({ ref: provided.innerRef }, provided.draggableProps, provided.dragHandleProps, { className: `rounded-lg border bg-card p-3 shadow-sm transition-shadow ${snapshot.isDragging ? "shadow-md ring-2 ring-primary/20" : ""}`, children: [_jsx("div", { className: "mb-1 text-sm font-medium leading-snug", children: card.title }), _jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx(Badge, { variant: (_a = STATUS_VARIANT[card.status]) !== null && _a !== void 0 ? _a : "outline", className: "text-xs", children: card.status }), card.updated_at && (_jsx("span", { className: "text-xs text-muted-foreground", children: formatTime(card.updated_at) }))] }), ((_b = card.metadata) === null || _b === void 0 ? void 0 : _b.agent_id) && (_jsxs("div", { className: "mt-1.5 text-xs text-muted-foreground", children: ["Agent: ", card.metadata.agent_id] }))] })));
        } }));
}
//# sourceMappingURL=BoardCard.js.map