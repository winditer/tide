"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { STATUS_BG, STATUS_LABEL, statusTone } from "./node-tones";
function formatTime(iso) {
    if (!iso)
        return "—";
    try {
        return new Date(iso).toLocaleTimeString("zh-CN");
    }
    catch (_a) {
        return iso;
    }
}
export function NodeRunList({ run, onApprove, onReject, isPending, }) {
    var _a;
    const runs = (_a = run.node_runs) !== null && _a !== void 0 ? _a : [];
    return (_jsxs("div", { className: "overflow-hidden border-2 border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]", children: [_jsxs("div", { className: "flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-4 py-2.5 text-white", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block h-2 w-2 bg-sky-400" }), _jsx("span", { className: "font-mono text-[11px] tracking-[0.3em]", children: "\u25F4 NODE TRACE" })] }), _jsxs("span", { className: "font-mono text-[10px] tracking-widest text-zinc-400", children: [runs.length, " NODES"] })] }), _jsx("div", { className: "max-h-[500px] overflow-y-auto", children: runs.length === 0 ? (_jsx("div", { className: "px-4 py-8 text-center font-mono text-xs text-zinc-500", children: "\u25C7 \u5C1A\u65E0\u8282\u70B9\u6267\u884C\u8BB0\u5F55" })) : (_jsx("ul", { className: "divide-y divide-zinc-200", children: runs.map((nr) => {
                        var _a, _b;
                        const tone = statusTone(nr.status);
                        const needsApproval = nr.node_type === "approval" && nr.status === "running";
                        return (_jsx("li", { className: "px-4 py-3", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: `flex h-6 w-6 shrink-0 items-center justify-center border border-zinc-900 ${tone.accent} ${tone.pulse}`, children: _jsx("span", { className: "font-mono text-[10px] text-white", children: tone.glyph }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "truncate text-[13px] font-bold text-zinc-900", children: nr.node_id }), _jsx("span", { className: "border border-zinc-300 bg-zinc-50 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-zinc-700", children: nr.node_type })] }), _jsxs("div", { className: "mt-0.5 flex items-center gap-3 font-mono text-[10px] text-zinc-600", children: [_jsx("span", { className: `px-1.5 py-[1px] ${(_a = STATUS_BG[nr.status]) !== null && _a !== void 0 ? _a : "bg-zinc-100"}`, children: (_b = STATUS_LABEL[nr.status]) !== null && _b !== void 0 ? _b : nr.status }), _jsxs("span", { children: ["\u25B8 ", formatTime(nr.started_at)] }), _jsxs("span", { children: ["\u25C2 ", formatTime(nr.finished_at)] })] }), nr.error && (_jsxs("div", { className: "mt-1.5 border border-rose-300 bg-rose-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-rose-800", children: ["\u2715 ", String(nr.error)] })), nr.output != null && (_jsx("pre", { className: "mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-800", children: typeof nr.output === "string"
                                                    ? nr.output
                                                    : JSON.stringify(nr.output, null, 2) }))] }), needsApproval && (_jsxs("div", { className: "flex shrink-0 flex-col gap-1", children: [_jsx("button", { disabled: isPending, onClick: () => onApprove === null || onApprove === void 0 ? void 0 : onApprove(nr.node_id), className: "border-2 border-emerald-700 bg-emerald-500 px-2 py-[2px] font-mono text-[10px] tracking-wider text-white shadow-[2px_2px_0_0_rgba(4,120,87,0.92)] hover:bg-emerald-400 disabled:opacity-50", children: "\u2713 \u6279\u51C6" }), _jsx("button", { disabled: isPending, onClick: () => onReject === null || onReject === void 0 ? void 0 : onReject(nr.node_id), className: "border-2 border-rose-700 bg-rose-500 px-2 py-[2px] font-mono text-[10px] tracking-wider text-white shadow-[2px_2px_0_0_rgba(190,18,60,0.92)] hover:bg-rose-400 disabled:opacity-50", children: "\u2715 \u62D2\u7EDD" })] }))] }) }, nr.id));
                    }) })) })] }));
}
//# sourceMappingURL=NodeRunList.js.map