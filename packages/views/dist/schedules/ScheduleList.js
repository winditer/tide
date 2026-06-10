"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Input } from "@tide/ui";
import { useToggleScheduleMutation, useDeleteScheduleMutation, useTriggerScheduleMutation, } from "@tide/core";
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
export function ScheduleList({ items, onEdit }) {
    const router = useRouter();
    const [search, setSearch] = useState("");
    const toggleMutation = useToggleScheduleMutation();
    const deleteMutation = useDeleteScheduleMutation();
    const triggerMutation = useTriggerScheduleMutation();
    const filtered = items.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.cron_expr.includes(search));
    if (items.length === 0) {
        return (_jsx("div", { className: "py-12 text-center text-muted-foreground", children: "\u6682\u65E0\u8C03\u5EA6\u4EFB\u52A1" }));
    }
    return (_jsxs("div", { children: [_jsx("div", { className: "mb-4", children: _jsx(Input, { placeholder: "\u641C\u7D22\u540D\u79F0\u6216 Cron \u8868\u8FBE\u5F0F...", value: search, onChange: (e) => setSearch(e.target.value), className: "max-w-sm" }) }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b text-left text-muted-foreground", children: [_jsx("th", { className: "px-3 py-3 font-medium", children: "\u540D\u79F0" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "Cron" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u72B6\u6001" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u4E0B\u6B21\u6267\u884C" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u4E0A\u6B21\u6267\u884C" }), _jsx("th", { className: "px-3 py-3 font-medium", children: "\u64CD\u4F5C" })] }) }), _jsx("tbody", { children: filtered.map((schedule) => (_jsxs("tr", { className: "cursor-pointer border-b transition-colors hover:bg-muted/50", onClick: () => router.push(`/schedules/${schedule.id}`), children: [_jsx("td", { className: "px-3 py-3 font-medium", children: schedule.name }), _jsx("td", { className: "px-3 py-3 font-mono text-xs", children: schedule.cron_expr }), _jsx("td", { className: "px-3 py-3", children: _jsx(Badge, { variant: schedule.enabled ? "default" : "secondary", children: schedule.enabled ? "启用" : "停用" }) }), _jsx("td", { className: "px-3 py-3 text-muted-foreground", children: formatTime(schedule.next_run_at) }), _jsx("td", { className: "px-3 py-3 text-muted-foreground", children: formatTime(schedule.last_run_at) }), _jsx("td", { className: "px-3 py-3", children: _jsxs("div", { className: "flex items-center gap-1", onClick: (e) => e.stopPropagation(), children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => toggleMutation.mutate(schedule.id), disabled: toggleMutation.isPending, children: schedule.enabled ? "停用" : "启用" }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => triggerMutation.mutate(schedule.id), disabled: triggerMutation.isPending, children: "\u89E6\u53D1" }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => onEdit === null || onEdit === void 0 ? void 0 : onEdit(schedule), children: "\u7F16\u8F91" }), _jsx(Button, { variant: "ghost", size: "sm", className: "text-destructive hover:text-destructive", onClick: () => {
                                                        if (confirm("确定删除该调度？")) {
                                                            deleteMutation.mutate(schedule.id);
                                                        }
                                                    }, disabled: deleteMutation.isPending, children: "\u5220\u9664" })] }) })] }, schedule.id))) })] }) }), filtered.length === 0 && items.length > 0 && (_jsx("div", { className: "py-8 text-center text-muted-foreground", children: "\u65E0\u5339\u914D\u7ED3\u679C" }))] }));
}
//# sourceMappingURL=ScheduleList.js.map