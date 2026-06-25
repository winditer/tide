"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { stageCategoryTone, statusTone } from "../node-tones";
const CATEGORY_LABEL = {
    todo: "TODO",
    in_progress: "IN-PROGRESS",
    review: "REVIEW",
    done: "DONE",
    custom: "CUSTOM",
};
const CATEGORY_GLYPH = {
    todo: "◇",
    in_progress: "▣",
    review: "◉",
    done: "■",
    custom: "◆",
};
function StageNodeImpl({ data, selected }) {
    var _a, _b, _c, _d, _e, _f, _g;
    const d = (_a = data) !== null && _a !== void 0 ? _a : {};
    const status = d.runStatus;
    const t = statusTone(status);
    const label = String((_b = d.label) !== null && _b !== void 0 ? _b : "Stage");
    const category = String((_c = d.category) !== null && _c !== void 0 ? _c : "todo");
    const cat = stageCategoryTone(category);
    const wipCount = typeof d.wip_count === "number" ? d.wip_count : null;
    return (_jsxs("div", { className: [
            "group relative w-[220px] select-none border-2 bg-white",
            t.border,
            t.shadow,
            "transition-transform duration-150",
            selected ? "translate-x-[-2px] translate-y-[-2px]" : "",
        ].join(" "), children: [_jsx(Handle, { type: "target", position: Position.Top, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${cat.accent}` }), _jsxs("div", { className: `flex items-center justify-between px-3 py-1 ${cat.accent} text-white ${t.pulse}`, children: [_jsxs("span", { className: "font-mono text-[9px] tracking-[0.25em]", children: ["STAGE \u00B7 ", (_d = CATEGORY_LABEL[category]) !== null && _d !== void 0 ? _d : category.toUpperCase()] }), _jsx("span", { className: "font-mono text-[10px]", children: (_e = CATEGORY_GLYPH[category]) !== null && _e !== void 0 ? _e : "◆" })] }), _jsxs("div", { className: `relative px-3 py-2.5 ${cat.surface}`, children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: `flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-900 ${cat.swatch} text-white`, children: _jsx("span", { className: "font-mono text-[11px]", children: (_f = CATEGORY_GLYPH[category]) !== null && _f !== void 0 ? _f : "◆" }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "truncate text-[13px] font-semibold text-zinc-900", children: label }), _jsx("div", { className: "mt-0.5 font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-600", children: (_g = CATEGORY_LABEL[category]) !== null && _g !== void 0 ? _g : category })] }), wipCount !== null && (_jsx("div", { className: `shrink-0 border-2 border-zinc-900 ${cat.surface} px-1.5 py-[1px] font-mono text-[10px] font-bold tabular-nums text-zinc-900`, children: wipCount }))] }), _jsxs("div", { className: "mt-2 flex items-center gap-[3px] border-t border-dashed border-zinc-300 pt-2", children: [Array.from({ length: 12 }).map((_, i) => (_jsx("span", { className: `h-[6px] w-[6px] ${i < 4 ? cat.swatch : "bg-zinc-200"}` }, i))), _jsxs("span", { className: "ml-auto font-mono text-[9px] tracking-widest text-zinc-500", children: ["COL \u00B7 ", category.toUpperCase().slice(0, 4)] })] })] }), _jsx(Handle, { type: "source", position: Position.Bottom, className: `!h-2.5 !w-2.5 !rounded-none !border-0 ${cat.accent}` })] }));
}
export const StageNode = memo(StageNodeImpl);
//# sourceMappingURL=StageNode.js.map