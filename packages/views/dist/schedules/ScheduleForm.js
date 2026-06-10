"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Button, Input, Select } from "@tide/ui";
import { useCreateScheduleMutation, useUpdateScheduleMutation, } from "@tide/core";
const TASK_TYPE_OPTIONS = [
    { label: "任务 (Task)", value: "task" },
    { label: "计划 (Plan)", value: "plan" },
];
/** Simple cron expression to human-readable description (Chinese) */
function cronToHuman(expr) {
    var _a;
    if (!expr.trim())
        return "";
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5)
        return "无效表达式";
    const [minute, hour, day, month, weekday] = parts;
    if (minute === "*" && hour === "*")
        return "每分钟执行";
    if (minute !== "*" && hour === "*")
        return `每小时第 ${minute} 分钟执行`;
    if (minute !== "*" && hour !== "*" && day === "*" && weekday === "*")
        return `每天 ${hour}:${minute.padStart(2, "0")} 执行`;
    if (weekday !== "*" && day === "*") {
        const days = ["日", "一", "二", "三", "四", "五", "六"];
        const d = (_a = days[Number(weekday)]) !== null && _a !== void 0 ? _a : weekday;
        return `每周${d} ${hour}:${minute.padStart(2, "0")} 执行`;
    }
    if (day !== "*" && month === "*")
        return `每月 ${day} 日 ${hour}:${minute.padStart(2, "0")} 执行`;
    return `${expr}`;
}
export function ScheduleForm({ schedule, onSuccess, onCancel }) {
    const [name, setName] = useState("");
    const [cronExpr, setCronExpr] = useState("");
    const [taskType, setTaskType] = useState("task");
    const [taskConfig, setTaskConfig] = useState("{}");
    const createMutation = useCreateScheduleMutation();
    const updateMutation = useUpdateScheduleMutation();
    const isEditMode = !!schedule;
    useEffect(() => {
        if (schedule) {
            setName(schedule.name);
            setCronExpr(schedule.cron_expr);
            setTaskType(schedule.task_type);
            setTaskConfig(JSON.stringify(schedule.task_config, null, 2));
        }
    }, [schedule]);
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim() || !cronExpr.trim())
            return;
        let config;
        try {
            config = JSON.parse(taskConfig);
        }
        catch (_a) {
            alert("task_config 不是有效的 JSON");
            return;
        }
        const params = {
            name: name.trim(),
            cron_expr: cronExpr.trim(),
            task_type: taskType,
            task_config: config,
        };
        try {
            if (isEditMode && schedule) {
                await updateMutation.mutateAsync({ id: schedule.id, params });
            }
            else {
                await createMutation.mutateAsync(params);
            }
            onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess();
        }
        catch (_b) {
            // error handled by mutation state
        }
    };
    const isPending = createMutation.isPending || updateMutation.isPending;
    const isError = createMutation.isError || updateMutation.isError;
    const error = createMutation.error || updateMutation.error;
    return (_jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u540D\u79F0 *" }), _jsx(Input, { placeholder: "\u8F93\u5165\u8C03\u5EA6\u540D\u79F0", value: name, onChange: (e) => setName(e.target.value), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "Cron \u8868\u8FBE\u5F0F *" }), _jsx(Input, { placeholder: "\u5982: 0 9 * * * (\u6BCF\u59299\u70B9)", value: cronExpr, onChange: (e) => setCronExpr(e.target.value), className: "font-mono", required: true }), cronExpr && (_jsx("p", { className: "mt-1 text-xs text-muted-foreground", children: cronToHuman(cronExpr) }))] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u4EFB\u52A1\u7C7B\u578B" }), _jsx(Select, { options: TASK_TYPE_OPTIONS, value: taskType, onChange: (e) => setTaskType(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u4EFB\u52A1\u914D\u7F6E (JSON)" }), _jsx("textarea", { className: "flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", placeholder: '{"prompt": "..."}', value: taskConfig, onChange: (e) => setTaskConfig(e.target.value) })] }), _jsxs("div", { className: "flex justify-end gap-2", children: [onCancel && (_jsx(Button, { type: "button", variant: "outline", onClick: onCancel, children: "\u53D6\u6D88" })), _jsx(Button, { type: "submit", disabled: isPending || !name.trim() || !cronExpr.trim(), children: isPending
                            ? isEditMode
                                ? "保存中..."
                                : "创建中..."
                            : isEditMode
                                ? "保存"
                                : "创建调度" })] }), isError && (_jsxs("p", { className: "text-sm text-destructive", children: ["\u64CD\u4F5C\u5931\u8D25\uFF1A", String(error)] }))] }));
}
//# sourceMappingURL=ScheduleForm.js.map