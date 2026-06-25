"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@tide/ui";
import { useDeleteWorkflow, useToggleWorkflow } from "@tide/core";
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
    const toggle = useToggleWorkflow();
    const filtered = items.filter((w) => {
        var _a;
        return w.name.toLowerCase().includes(search.toLowerCase()) ||
            ((_a = w.description) !== null && _a !== void 0 ? _a : "").toLowerCase().includes(search.toLowerCase());
    });
    if (items.length === 0) {
        return (_jsxs("div", { className: "bg-card rounded-xl p-16 text-center", children: [_jsx("div", { className: "text-xs font-medium text-muted-foreground", children: "\u6682\u65E0\u5DE5\u4F5C\u6D41" }), _jsx("div", { className: "mt-2 text-sm text-muted-foreground", children: "\u70B9\u51FB\u53F3\u4E0A\u89D2\u300C\u521B\u5EFA\u5DE5\u4F5C\u6D41\u300D\u5F00\u59CB" })] }));
    }
    return (_jsxs("div", { className: "overflow-hidden", children: [_jsx("div", { className: "border-b border-border/50 px-4 py-3", children: _jsx(Input, { placeholder: "\u641C\u7D22\u5DE5\u4F5C\u6D41\u540D\u79F0\u6216\u63CF\u8FF0...", value: search, onChange: (e) => setSearch(e.target.value), className: "max-w-sm rounded-lg" }) }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-border/50 bg-muted/30", children: [_jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u540D\u79F0" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u63CF\u8FF0" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u8282\u70B9" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u7248\u672C" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u66F4\u65B0\u65F6\u95F4" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u72B6\u6001" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "\u64CD\u4F5C" })] }) }), _jsx("tbody", { className: "divide-y divide-border/50", children: filtered.map((w) => {
                                var _a, _b, _c;
                                const nodeCount = (_c = (_b = (_a = w.definition) === null || _a === void 0 ? void 0 : _a.nodes) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0;
                                return (_jsxs("tr", { className: "cursor-pointer transition-colors hover:bg-muted/30", onClick: () => router.push(`/workflows/${w.id}`), children: [_jsx("td", { className: "px-4 py-3 font-semibold text-foreground", children: w.name }), _jsx("td", { className: "max-w-xs px-4 py-3 truncate text-muted-foreground", children: w.description || "—" }), _jsxs("td", { className: "px-4 py-3 font-mono text-xs text-muted-foreground", children: [nodeCount, " \u4E2A"] }), _jsxs("td", { className: "px-4 py-3 font-mono text-xs text-muted-foreground", children: ["v", w.version] }), _jsx("td", { className: "px-4 py-3 text-xs text-muted-foreground", children: formatTime(w.updated_at) }), _jsx("td", { className: "px-4 py-3", onClick: (e) => e.stopPropagation(), children: _jsxs("button", { type: "button", disabled: toggle.isPending, onClick: () => toggle.mutate(w.id), title: w.enabled ? "点击禁用" : "点击启用", className: `inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-smooth disabled:opacity-50 ${w.enabled
                                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                    : "border-border bg-muted text-muted-foreground"}`, children: [_jsx("span", { className: `h-1.5 w-1.5 rounded-full ${w.enabled ? "bg-emerald-500" : "bg-zinc-400"}` }), w.enabled ? "已启用" : "已禁用"] }) }), _jsx("td", { className: "px-4 py-3", onClick: (e) => e.stopPropagation(), children: _jsxs("div", { className: "flex items-center gap-1", children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => router.push(`/workflows/${w.id}`), children: "\u7F16\u8F91" }), _jsx(Button, { variant: "ghost", size: "sm", className: "text-destructive hover:text-destructive", onClick: () => {
                                                            if (confirm(`确定删除「${w.name}」？`)) {
                                                                del.mutate(w.id);
                                                            }
                                                        }, disabled: del.isPending, children: "\u5220\u9664" })] }) })] }, w.id));
                            }) })] }) }), filtered.length === 0 && items.length > 0 && (_jsx("div", { className: "px-4 py-8 text-center text-xs text-muted-foreground", children: "\u65E0\u5339\u914D\u7ED3\u679C" }))] }));
}
//# sourceMappingURL=WorkflowList.js.map