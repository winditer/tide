"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Button, Input, Select } from "@tide/ui";
import { useCreateScheduleMutation, useUpdateScheduleMutation, } from "@tide/core";
const TASK_TYPE_OPTIONS = [
    { label: "Agent 任务", value: "agent" },
    { label: "Plan 计划", value: "plan" },
    { label: "状态查询", value: "status" },
    { label: "自定义", value: "custom" },
];
const TRIGGER_TYPE_OPTIONS = [
    { label: "Cron 表达式", value: "cron" },
    { label: "固定间隔", value: "interval" },
    { label: "指定时间", value: "date" },
];
const DEFAULT_TIMEZONE = "Asia/Shanghai";
/** 默认 cron 示例：工作日 9 点 */
const DEFAULT_CRON_EXAMPLE = "0 9 * * 1-5";
/** 默认 interval 示例：每 1 小时 */
const DEFAULT_INTERVAL_EXAMPLE = { hours: "1", minutes: "0" };
/** 计算下一个整点的本地 ISO 时间，带时区偏移，例如 2026-06-11T10:00:00+08:00 */
function nextHourLocalIso() {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    const tzMin = -d.getTimezoneOffset();
    const sign = tzMin >= 0 ? "+" : "-";
    const tzh = pad(Math.floor(Math.abs(tzMin) / 60));
    const tzm = pad(Math.abs(tzMin) % 60);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${tzh}:${tzm}`;
}
/** 根据任务类型生成默认 task_config 示例 */
function getTaskConfigExample(type) {
    switch (type) {
        case "agent":
            return JSON.stringify({ prompt: "请描述需要执行的任务", agent_id: "codex", model: "", cwd: "" }, null, 2);
        case "plan":
            return JSON.stringify({ prompt: "计划任务内容", agent_id: "codex", max_parallel: 1 }, null, 2);
        case "status":
            return JSON.stringify({ prompt: "查询当前任务状态" }, null, 2);
        case "custom":
            return JSON.stringify({ prompt: "自定义任务内容" }, null, 2);
        default:
            return "{}";
    }
}
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
    const [description, setDescription] = useState("");
    const [triggerType, setTriggerType] = useState("cron");
    // cron-specific state
    const [cronExpr, setCronExpr] = useState("");
    const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
    // interval-specific state
    const [intervalHours, setIntervalHours] = useState("0");
    const [intervalMinutes, setIntervalMinutes] = useState("0");
    // date-specific state
    const [runAt, setRunAt] = useState("");
    const [taskType, setTaskType] = useState("agent");
    const [taskConfig, setTaskConfig] = useState("{}");
    // 记录用户是否手动修改过各分组字段，用于决定是否需要自动填充默认示例
    const [touchedCron, setTouchedCron] = useState(false);
    const [touchedInterval, setTouchedInterval] = useState(false);
    const [touchedDate, setTouchedDate] = useState(false);
    const [touchedTaskConfig, setTouchedTaskConfig] = useState(false);
    const createMutation = useCreateScheduleMutation();
    const updateMutation = useUpdateScheduleMutation();
    const isEditMode = !!schedule;
    useEffect(() => {
        var _a, _b, _c, _d, _e, _f, _g;
        if (schedule) {
            setName(schedule.name);
            setDescription((_a = schedule.description) !== null && _a !== void 0 ? _a : "");
            const tt = ((_b = schedule.trigger_type) !== null && _b !== void 0 ? _b : "cron");
            setTriggerType(tt);
            const tc = (_c = schedule.trigger_config) !== null && _c !== void 0 ? _c : {};
            if (tt === "cron") {
                setCronExpr(typeof tc.cron === "string" ? tc.cron : "");
                setTimezone(typeof tc.timezone === "string" ? tc.timezone : DEFAULT_TIMEZONE);
            }
            else if (tt === "interval") {
                setIntervalHours(String((_d = tc.hours) !== null && _d !== void 0 ? _d : 0));
                setIntervalMinutes(String((_e = tc.minutes) !== null && _e !== void 0 ? _e : 0));
            }
            else if (tt === "date") {
                setRunAt(typeof tc.run_at === "string" ? tc.run_at : "");
            }
            setTaskType((_f = schedule.task_type) !== null && _f !== void 0 ? _f : "agent");
            setTaskConfig(JSON.stringify((_g = schedule.task_config) !== null && _g !== void 0 ? _g : {}, null, 2));
            // 编辑模式下视为已手动设置过，避免被自动示例覆盖
            setTouchedCron(true);
            setTouchedInterval(true);
            setTouchedDate(true);
            setTouchedTaskConfig(true);
        }
    }, [schedule]);
    // 切换触发类型时，若用户未手动修改过该分组字段，自动填充默认示例
    useEffect(() => {
        if (isEditMode)
            return;
        if (triggerType === "cron" && !touchedCron && !cronExpr.trim()) {
            setCronExpr(DEFAULT_CRON_EXAMPLE);
        }
        else if (triggerType === "interval" &&
            !touchedInterval &&
            (intervalHours === "" || intervalHours === "0") &&
            (intervalMinutes === "" || intervalMinutes === "0")) {
            setIntervalHours(DEFAULT_INTERVAL_EXAMPLE.hours);
            setIntervalMinutes(DEFAULT_INTERVAL_EXAMPLE.minutes);
        }
        else if (triggerType === "date" && !touchedDate && !runAt.trim()) {
            setRunAt(nextHourLocalIso());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triggerType, isEditMode]);
    // 切换任务类型时，若用户未手动修改过 task_config，自动填充示例
    useEffect(() => {
        if (isEditMode)
            return;
        if (touchedTaskConfig)
            return;
        setTaskConfig(getTaskConfigExample(taskType));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskType, isEditMode]);
    const buildTriggerConfig = () => {
        if (triggerType === "cron") {
            if (!cronExpr.trim())
                return { ok: false, error: "请输入 cron 表达式" };
            return {
                ok: true,
                config: {
                    cron: cronExpr.trim(),
                    timezone: timezone.trim() || DEFAULT_TIMEZONE,
                },
            };
        }
        if (triggerType === "interval") {
            const h = Number(intervalHours);
            const m = Number(intervalMinutes);
            if (!Number.isFinite(h) || !Number.isFinite(m) || (h <= 0 && m <= 0)) {
                return { ok: false, error: "间隔的小时与分钟至少有一项大于 0" };
            }
            const cfg = {};
            if (h > 0)
                cfg.hours = h;
            if (m > 0)
                cfg.minutes = m;
            return { ok: true, config: cfg };
        }
        if (triggerType === "date") {
            if (!runAt.trim())
                return { ok: false, error: "请选择执行时间" };
            return { ok: true, config: { run_at: runAt.trim() } };
        }
        return { ok: false, error: "未知的触发类型" };
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim())
            return;
        const triggerResult = buildTriggerConfig();
        if (!triggerResult.ok) {
            alert(triggerResult.error);
            return;
        }
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
            trigger_type: triggerType,
            trigger_config: triggerResult.config,
            task_type: taskType,
            task_config: config,
        };
        if (description.trim()) {
            params.description = description.trim();
        }
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
    const submitDisabled = isPending ||
        !name.trim() ||
        (triggerType === "cron" && !cronExpr.trim()) ||
        (triggerType === "date" && !runAt.trim());
    return (_jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u540D\u79F0 *" }), _jsx(Input, { placeholder: "\u8F93\u5165\u8C03\u5EA6\u540D\u79F0", value: name, onChange: (e) => setName(e.target.value), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u63CF\u8FF0" }), _jsx(Input, { placeholder: "\u53EF\u9009\u63CF\u8FF0", value: description, onChange: (e) => setDescription(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u89E6\u53D1\u7C7B\u578B" }), _jsx(Select, { options: TRIGGER_TYPE_OPTIONS, value: triggerType, onChange: (e) => setTriggerType(e.target.value) })] }), triggerType === "cron" && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "Cron \u8868\u8FBE\u5F0F *" }), _jsx(Input, { placeholder: "\u5982: 0 9 * * 1-5 \uFF08\u5DE5\u4F5C\u65E5 9 \u70B9\uFF09", value: cronExpr, onChange: (e) => {
                                    setCronExpr(e.target.value);
                                    setTouchedCron(true);
                                }, className: "font-mono", required: true }), cronExpr && (_jsx("p", { className: "mt-1 text-xs text-muted-foreground", children: cronToHuman(cronExpr) }))] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u65F6\u533A" }), _jsx(Input, { placeholder: "Asia/Shanghai", value: timezone, onChange: (e) => setTimezone(e.target.value) })] })] })), triggerType === "interval" && (_jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u5C0F\u65F6" }), _jsx(Input, { type: "number", min: "0", placeholder: "0", value: intervalHours, onChange: (e) => {
                                    setIntervalHours(e.target.value);
                                    setTouchedInterval(true);
                                } })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u5206\u949F" }), _jsx(Input, { type: "number", min: "0", placeholder: "0", value: intervalMinutes, onChange: (e) => {
                                    setIntervalMinutes(e.target.value);
                                    setTouchedInterval(true);
                                } })] })] })), triggerType === "date" && (_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u6267\u884C\u65F6\u95F4 *" }), _jsx(Input, { placeholder: "2026-06-10T15:00:00+08:00", value: runAt, onChange: (e) => {
                            setRunAt(e.target.value);
                            setTouchedDate(true);
                        }, className: "font-mono", required: true }), _jsx("p", { className: "mt-1 text-xs text-muted-foreground", children: "ISO 8601 \u683C\u5F0F\uFF0C\u5EFA\u8BAE\u5E26\u65F6\u533A\u504F\u79FB" })] })), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u4EFB\u52A1\u7C7B\u578B" }), _jsx(Select, { options: TASK_TYPE_OPTIONS, value: taskType, onChange: (e) => setTaskType(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u4EFB\u52A1\u914D\u7F6E (JSON)" }), _jsx("textarea", { className: "flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", placeholder: '{"prompt": "..."}', value: taskConfig, onChange: (e) => {
                            setTaskConfig(e.target.value);
                            setTouchedTaskConfig(true);
                        } })] }), _jsxs("div", { className: "flex justify-end gap-2", children: [onCancel && (_jsx(Button, { type: "button", variant: "outline", onClick: onCancel, children: "\u53D6\u6D88" })), _jsx(Button, { type: "submit", disabled: submitDisabled, children: isPending
                            ? isEditMode
                                ? "保存中..."
                                : "创建中..."
                            : isEditMode
                                ? "保存"
                                : "创建调度" })] }), isError && (_jsxs("p", { className: "text-sm text-destructive", children: ["\u64CD\u4F5C\u5931\u8D25\uFF1A", String(error)] }))] }));
}
//# sourceMappingURL=ScheduleForm.js.map