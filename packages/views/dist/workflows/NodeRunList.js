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
    return (_jsxs("div", { className: "overflow-hidden bg-card rounded-xl shadow-card border border-border/50", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border/50 px-4 py-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block h-2 w-2 rounded-full bg-sky-500" }), _jsx("span", { className: "text-xs font-medium text-foreground", children: "\u8282\u70B9\u6267\u884C\u8BB0\u5F55" })] }), _jsxs("span", { className: "text-[10px] text-muted-foreground", children: [runs.length, " \u4E2A\u8282\u70B9"] })] }), _jsx("div", { className: "max-h-[500px] overflow-y-auto", children: runs.length === 0 ? (_jsx("div", { className: "px-4 py-8 text-center text-xs text-muted-foreground", children: "\u5C1A\u65E0\u8282\u70B9\u6267\u884C\u8BB0\u5F55" })) : (_jsx("ul", { className: "divide-y divide-border/50", children: runs.map((nr) => {
                        var _a, _b;
                        const tone = statusTone(nr.status);
                        const needsApproval = nr.node_type === "approval" && nr.status === "running";
                        return (_jsx("li", { className: "px-4 py-3 hover:bg-muted/30 transition-smooth", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: `flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tone.accent} ${tone.pulse}`, children: _jsx("span", { className: "text-[10px] text-white", children: tone.glyph }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "truncate text-sm font-medium text-foreground", children: nr.node_id }), _jsx("span", { className: "rounded-md border border-border bg-muted px-1.5 py-[1px] text-[9px] uppercase text-muted-foreground", children: nr.node_type })] }), _jsxs("div", { className: "mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground", children: [_jsx("span", { className: `rounded-md px-1.5 py-[1px] ${(_a = STATUS_BG[nr.status]) !== null && _a !== void 0 ? _a : "bg-muted"}`, children: (_b = STATUS_LABEL[nr.status]) !== null && _b !== void 0 ? _b : nr.status }), _jsxs("span", { children: ["\u5F00\u59CB ", formatTime(nr.started_at)] }), _jsxs("span", { children: ["\u7ED3\u675F ", formatTime(nr.finished_at)] })] }), nr.error && (_jsx("div", { className: "mt-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] leading-relaxed text-rose-800", children: String(nr.error) })), nr.output != null && (_jsx("pre", { className: "mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[10px] leading-relaxed text-foreground", children: typeof nr.output === "string"
                                                    ? nr.output
                                                    : JSON.stringify(nr.output, null, 2) }))] }), needsApproval && (_jsxs("div", { className: "flex shrink-0 flex-col gap-1", children: [_jsx("button", { disabled: isPending, onClick: () => onApprove === null || onApprove === void 0 ? void 0 : onApprove(nr.node_id), className: "rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-400 disabled:opacity-50 transition-smooth", children: "\u2713 \u6279\u51C6" }), _jsx("button", { disabled: isPending, onClick: () => onReject === null || onReject === void 0 ? void 0 : onReject(nr.node_id), className: "rounded-md bg-rose-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-rose-400 disabled:opacity-50 transition-smooth", children: "\u2715 \u62D2\u7EDD" })] }))] }) }, nr.id));
                    }) })) })] }));
}
//# sourceMappingURL=NodeRunList.js.map