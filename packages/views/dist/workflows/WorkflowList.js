"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@tide/ui";
import { useDeleteWorkflow } from "@tide/core";
function formatTime(iso) {
    if (!iso)
        return "—";
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
export function WorkflowList({ items }) {
    const router = useRouter();
    const [search, setSearch] = useState("");
    const del = useDeleteWorkflow();
    const filtered = items.filter((w) => {
        var _a;
        return w.name.toLowerCase().includes(search.toLowerCase()) ||
            ((_a = w.description) !== null && _a !== void 0 ? _a : "").toLowerCase().includes(search.toLowerCase());
    });
    if (items.length === 0) {
        return (_jsxs("div", { className: "border-2 border-dashed border-zinc-400 bg-white px-6 py-16 text-center shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]", children: [_jsx("div", { className: "font-mono text-[11px] tracking-[0.3em] text-zinc-500", children: "\u25C7 NO WORKFLOWS YET" }), _jsx("div", { className: "mt-2 text-sm text-zinc-500", children: "\u70B9\u51FB\u53F3\u4E0A\u89D2\u300C\u521B\u5EFA\u5DE5\u4F5C\u6D41\u300D\u5F00\u59CB" })] }));
    }
    return (_jsxs("div", { className: "overflow-hidden border-2 border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]", children: [_jsxs("div", { className: "flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 px-4 py-2.5 text-white", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block h-2 w-2 bg-emerald-400" }), _jsx("span", { className: "font-mono text-[11px] tracking-[0.3em]", children: "\u25F3 WORKFLOWS" })] }), _jsxs("span", { className: "font-mono text-[10px] tracking-widest text-zinc-400", children: [items.length, " ITEMS"] })] }), _jsx("div", { className: "border-b border-zinc-200 bg-zinc-50 px-4 py-3", children: _jsx(Input, { placeholder: "\u641C\u7D22\u5DE5\u4F5C\u6D41\u540D\u79F0\u6216\u63CF\u8FF0...", value: search, onChange: (e) => setSearch(e.target.value), className: "max-w-sm" }) }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b-2 border-zinc-900 bg-zinc-50", children: [_jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "NAME" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "DESCRIPTION" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "NODES" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "VER" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "UPDATED" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "STATUS" }), _jsx("th", { className: "px-3 py-2 text-left font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "ACTIONS" })] }) }), _jsx("tbody", { children: filtered.map((w) => {
                                var _a, _b, _c;
                                const nodeCount = (_c = (_b = (_a = w.definition) === null || _a === void 0 ? void 0 : _a.nodes) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0;
                                return (_jsxs("tr", { className: "cursor-pointer border-b border-zinc-200 transition-colors hover:bg-zinc-50", onClick: () => router.push(`/workflows/${w.id}`), children: [_jsx("td", { className: "px-3 py-3 font-semibold text-zinc-900", children: w.name }), _jsx("td", { className: "max-w-xs px-3 py-3 truncate text-zinc-600", children: w.description || "—" }), _jsxs("td", { className: "px-3 py-3 font-mono text-[11px] text-zinc-700", children: ["\u25F0 ", nodeCount] }), _jsxs("td", { className: "px-3 py-3 font-mono text-[11px] text-zinc-700", children: ["v", w.version] }), _jsx("td", { className: "px-3 py-3 font-mono text-[11px] text-zinc-700", children: formatTime(w.updated_at) }), _jsx("td", { className: "px-3 py-3", children: _jsx("span", { className: `inline-flex items-center gap-1 border px-2 py-[2px] font-mono text-[10px] tracking-[0.2em] ${w.enabled
                                                    ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                                                    : "border-zinc-400 bg-zinc-100 text-zinc-700"}`, children: w.enabled ? "● ENABLED" : "○ DISABLED" }) }), _jsx("td", { className: "px-3 py-3", onClick: (e) => e.stopPropagation(), children: _jsxs("div", { className: "flex items-center gap-1", children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => router.push(`/workflows/${w.id}`), children: "\u7F16\u8F91" }), _jsx(Button, { variant: "ghost", size: "sm", className: "text-destructive hover:text-destructive", onClick: () => {
                                                            if (confirm(`确定删除「${w.name}」？`)) {
                                                                del.mutate(w.id);
                                                            }
                                                        }, disabled: del.isPending, children: "\u5220\u9664" })] }) })] }, w.id));
                            }) })] }) }), filtered.length === 0 && items.length > 0 && (_jsx("div", { className: "px-4 py-8 text-center font-mono text-[11px] tracking-widest text-zinc-500", children: "\u25C7 NO MATCHES" }))] }));
}
//# sourceMappingURL=WorkflowList.js.map