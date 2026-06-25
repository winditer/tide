"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Draggable } from "@hello-pangea/dnd";
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@tide/ui";
// Icons (inline SVGs for LayoutGrid, Plus, Eye)
function LayoutGridIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("rect", { width: "7", height: "7", x: "3", y: "3", rx: "1" }), _jsx("rect", { width: "7", height: "7", x: "14", y: "3", rx: "1" }), _jsx("rect", { width: "7", height: "7", x: "3", y: "14", rx: "1" }), _jsx("rect", { width: "7", height: "7", x: "14", y: "14", rx: "1" })] }));
}
function PlusIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M5 12h14" }), _jsx("path", { d: "M12 5v14" })] }));
}
function EyeIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }), _jsx("circle", { cx: "12", cy: "12", r: "3" })] }));
}
function getHealthTooltip(card) {
    var _a, _b, _c, _d, _e;
    const meta = (_a = card.metadata) !== null && _a !== void 0 ? _a : {};
    const health = meta.health;
    const stats = meta.work_item_stats;
    if (health === "green")
        return "项目健康";
    if (health === "yellow") {
        const stale = (_b = stats === null || stats === void 0 ? void 0 : stats.stale_count) !== null && _b !== void 0 ? _b : 0;
        return `有 ${stale} 个工作项滞留超过3天`;
    }
    if (health === "red") {
        const stale = (_c = stats === null || stats === void 0 ? void 0 : stats.stale_count) !== null && _c !== void 0 ? _c : 0;
        const total = (_d = stats === null || stats === void 0 ? void 0 : stats.total) !== null && _d !== void 0 ? _d : 0;
        const completed = (_e = stats === null || stats === void 0 ? void 0 : stats.completed) !== null && _e !== void 0 ? _e : 0;
        const incomplete = total - completed;
        if (incomplete > 0 && stale / incomplete >= 0.5) {
            return "超过50%工作项滞留";
        }
        return "项目超过7天无活动";
    }
    return "";
}
export function ProjectCard({ card, index }) {
    var _a, _b, _c, _d;
    const router = useRouter();
    const meta = (_a = card.metadata) !== null && _a !== void 0 ? _a : {};
    const workItemStats = (_b = meta.work_item_stats) !== null && _b !== void 0 ? _b : { total: 0, completed: 0, stale_count: 0 };
    const members = (_c = meta.members) !== null && _c !== void 0 ? _c : [];
    const health = (_d = meta.health) !== null && _d !== void 0 ? _d : "green";
    const healthTooltip = getHealthTooltip(card);
    const progressPercent = workItemStats.total > 0
        ? (workItemStats.completed / workItemStats.total) * 100
        : 0;
    const handleCardClick = (e) => {
        if (e.button !== 0)
            return;
        // Don't navigate if clicking action buttons
        if (e.target.closest("[data-action]"))
            return;
        router.push(`/projects/${card.id}`);
    };
    return (_jsx(Draggable, { draggableId: card.id, index: index, children: (provided, snapshot) => (_jsxs("div", Object.assign({ ref: provided.innerRef }, provided.draggableProps, provided.dragHandleProps, { style: provided.draggableProps.style, onClick: handleCardClick, role: "button", tabIndex: 0, className: cn("group relative rounded-lg border border-border/50 bg-card p-4 shadow-card transition-smooth", snapshot.isDragging
                ? "shadow-card-hover ring-2 ring-primary/30 -rotate-1"
                : "cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover"), children: [_jsx(TooltipProvider, { delayDuration: 200, children: _jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsx("div", { className: cn("absolute top-3 right-3 w-2.5 h-2.5 rounded-full", health === "green" && "bg-emerald-400", health === "yellow" && "bg-amber-400", health === "red" && "bg-red-400") }) }), _jsx(TooltipContent, { side: "left", className: "text-xs", children: healthTooltip })] }) }), _jsx("h4", { className: "font-medium text-sm pr-6 line-clamp-1", children: card.title || "(无标题)" }), meta.workflow_name && (_jsx("span", { className: "text-[10px] text-muted-foreground mt-0.5 block", children: meta.workflow_name })), workItemStats.total > 0 && (_jsxs("div", { className: "mt-3", children: [_jsxs("div", { className: "flex justify-between text-[11px] text-muted-foreground mb-1", children: [_jsx("span", { children: "\u5DE5\u4F5C\u9879" }), _jsxs("span", { children: [workItemStats.completed, "/", workItemStats.total] })] }), _jsx("div", { className: "h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-emerald-400 rounded-full transition-all", style: { width: `${progressPercent}%` } }) })] })), _jsxs("div", { className: "flex items-center justify-between mt-3", children: [_jsxs("div", { className: "flex -space-x-1.5", children: [members.slice(0, 4).map((m) => {
                                    var _a;
                                    return (_jsx("div", { className: "w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-[9px] flex items-center justify-center text-indigo-700 dark:text-indigo-300 border border-white dark:border-gray-800", title: m.display_name, children: ((_a = m.display_name) === null || _a === void 0 ? void 0 : _a[0]) || "?" }, m.user_id));
                                }), members.length > 4 && (_jsxs("div", { className: "w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 text-[9px] flex items-center justify-center text-gray-500 border border-white dark:border-gray-800", children: ["+", members.length - 4] }))] }), meta.active_version && (_jsx("span", { className: "text-[10px] px-1.5 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 rounded", children: meta.active_version }))] }), _jsxs("div", { "data-action": "true", className: "absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1", children: [_jsx(Link, { href: `/work-items?project=${card.id}`, onClick: (e) => e.stopPropagation(), children: _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", title: "\u5DE5\u4F5C\u9879\u770B\u677F", children: _jsx(LayoutGridIcon, { className: "h-3.5 w-3.5" }) }) }), _jsx(Link, { href: `/work-items?create=true&project=${card.id}`, onClick: (e) => e.stopPropagation(), children: _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", title: "\u521B\u5EFA\u5DE5\u4F5C\u9879", children: _jsx(PlusIcon, { className: "h-3.5 w-3.5" }) }) }), _jsx(Link, { href: `/projects/${card.id}`, onClick: (e) => e.stopPropagation(), children: _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", title: "\u9879\u76EE\u8BE6\u60C5", children: _jsx(EyeIcon, { className: "h-3.5 w-3.5" }) }) })] })] }))) }));
}
//# sourceMappingURL=ProjectCard.js.map