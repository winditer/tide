"use client";

import { useState, useEffect } from "react";
import { Button, Input, Select } from "@tide/ui";
import {
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
} from "@tide/core";
import type {
  Schedule,
  CreateScheduleInput,
  TriggerType,
  ScheduleTaskType,
} from "@tide/core";

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
function nextHourLocalIso(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const tzh = pad(Math.floor(Math.abs(tzMin) / 60));
  const tzm = pad(Math.abs(tzMin) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${tzh}:${tzm}`;
}

/** 根据任务类型生成默认 task_config 示例 */
function getTaskConfigExample(type: ScheduleTaskType): string {
  switch (type) {
    case "agent":
      return JSON.stringify(
        { prompt: "请描述需要执行的任务", agent_id: "codex", model: "", cwd: "" },
        null,
        2
      );
    case "plan":
      return JSON.stringify(
        { prompt: "计划任务内容", agent_id: "codex", max_parallel: 1 },
        null,
        2
      );
    case "status":
      return JSON.stringify({ prompt: "查询当前任务状态" }, null, 2);
    case "custom":
      return JSON.stringify({ prompt: "自定义任务内容" }, null, 2);
    default:
      return "{}";
  }
}

/** Simple cron expression to human-readable description (Chinese) */
function cronToHuman(expr: string): string {
  if (!expr.trim()) return "";
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return "无效表达式";

  const [minute, hour, day, month, weekday] = parts;

  if (minute === "*" && hour === "*") return "每分钟执行";
  if (minute !== "*" && hour === "*") return `每小时第 ${minute} 分钟执行`;
  if (minute !== "*" && hour !== "*" && day === "*" && weekday === "*")
    return `每天 ${hour}:${minute.padStart(2, "0")} 执行`;
  if (weekday !== "*" && day === "*") {
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    const d = days[Number(weekday)] ?? weekday;
    return `每周${d} ${hour}:${minute.padStart(2, "0")} 执行`;
  }
  if (day !== "*" && month === "*")
    return `每月 ${day} 日 ${hour}:${minute.padStart(2, "0")} 执行`;

  return `${expr}`;
}

interface ScheduleFormProps {
  schedule?: Schedule | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ScheduleForm({ schedule, onSuccess, onCancel }: ScheduleFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("cron");

  // cron-specific state
  const [cronExpr, setCronExpr] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  // interval-specific state
  const [intervalHours, setIntervalHours] = useState("0");
  const [intervalMinutes, setIntervalMinutes] = useState("0");

  // date-specific state
  const [runAt, setRunAt] = useState("");

  const [taskType, setTaskType] = useState<ScheduleTaskType>("agent");
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
    if (schedule) {
      setName(schedule.name);
      setDescription(schedule.description ?? "");
      const tt = (schedule.trigger_type ?? "cron") as TriggerType;
      setTriggerType(tt);
      const tc = schedule.trigger_config ?? {};
      if (tt === "cron") {
        setCronExpr(typeof tc.cron === "string" ? tc.cron : "");
        setTimezone(typeof tc.timezone === "string" ? tc.timezone : DEFAULT_TIMEZONE);
      } else if (tt === "interval") {
        setIntervalHours(String(tc.hours ?? 0));
        setIntervalMinutes(String(tc.minutes ?? 0));
      } else if (tt === "date") {
        setRunAt(typeof tc.run_at === "string" ? tc.run_at : "");
      }
      setTaskType((schedule.task_type as ScheduleTaskType) ?? "agent");
      setTaskConfig(JSON.stringify(schedule.task_config ?? {}, null, 2));
      // 编辑模式下视为已手动设置过，避免被自动示例覆盖
      setTouchedCron(true);
      setTouchedInterval(true);
      setTouchedDate(true);
      setTouchedTaskConfig(true);
    }
  }, [schedule]);

  // 切换触发类型时，若用户未手动修改过该分组字段，自动填充默认示例
  useEffect(() => {
    if (isEditMode) return;
    if (triggerType === "cron" && !touchedCron && !cronExpr.trim()) {
      setCronExpr(DEFAULT_CRON_EXAMPLE);
    } else if (
      triggerType === "interval" &&
      !touchedInterval &&
      (intervalHours === "" || intervalHours === "0") &&
      (intervalMinutes === "" || intervalMinutes === "0")
    ) {
      setIntervalHours(DEFAULT_INTERVAL_EXAMPLE.hours);
      setIntervalMinutes(DEFAULT_INTERVAL_EXAMPLE.minutes);
    } else if (triggerType === "date" && !touchedDate && !runAt.trim()) {
      setRunAt(nextHourLocalIso());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerType, isEditMode]);

  // 切换任务类型时，若用户未手动修改过 task_config，自动填充示例
  useEffect(() => {
    if (isEditMode) return;
    if (touchedTaskConfig) return;
    setTaskConfig(getTaskConfigExample(taskType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskType, isEditMode]);

  const buildTriggerConfig = (): { ok: boolean; config?: Record<string, any>; error?: string } => {
    if (triggerType === "cron") {
      if (!cronExpr.trim()) return { ok: false, error: "请输入 cron 表达式" };
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
      const cfg: Record<string, any> = {};
      if (h > 0) cfg.hours = h;
      if (m > 0) cfg.minutes = m;
      return { ok: true, config: cfg };
    }
    if (triggerType === "date") {
      if (!runAt.trim()) return { ok: false, error: "请选择执行时间" };
      return { ok: true, config: { run_at: runAt.trim() } };
    }
    return { ok: false, error: "未知的触发类型" };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const triggerResult = buildTriggerConfig();
    if (!triggerResult.ok) {
      alert(triggerResult.error);
      return;
    }

    let config: Record<string, any>;
    try {
      config = JSON.parse(taskConfig);
    } catch {
      alert("task_config 不是有效的 JSON");
      return;
    }

    const params: CreateScheduleInput = {
      name: name.trim(),
      trigger_type: triggerType,
      trigger_config: triggerResult.config!,
      task_type: taskType,
      task_config: config,
    };
    if (description.trim()) {
      params.description = description.trim();
    }

    try {
      if (isEditMode && schedule) {
        await updateMutation.mutateAsync({ id: schedule.id, params });
      } else {
        await createMutation.mutateAsync(params);
      }
      onSuccess?.();
    } catch {
      // error handled by mutation state
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isError = createMutation.isError || updateMutation.isError;
  const error = createMutation.error || updateMutation.error;

  const submitDisabled =
    isPending ||
    !name.trim() ||
    (triggerType === "cron" && !cronExpr.trim()) ||
    (triggerType === "date" && !runAt.trim());

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium">名称 *</label>
        <Input
          placeholder="输入调度名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">描述</label>
        <Input
          placeholder="可选描述"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">触发类型</label>
        <Select
          options={TRIGGER_TYPE_OPTIONS}
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as TriggerType)}
        />
      </div>

      {triggerType === "cron" && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Cron 表达式 *
            </label>
            <Input
              placeholder="如: 0 9 * * 1-5 （工作日 9 点）"
              value={cronExpr}
              onChange={(e) => {
                setCronExpr(e.target.value);
                setTouchedCron(true);
              }}
              className="font-mono"
              required
            />
            {cronExpr && (
              <p className="mt-1 text-xs text-muted-foreground">
                {cronToHuman(cronExpr)}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">时区</label>
            <Input
              placeholder="Asia/Shanghai"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </div>
        </>
      )}

      {triggerType === "interval" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">小时</label>
            <Input
              type="number"
              min="0"
              placeholder="0"
              value={intervalHours}
              onChange={(e) => {
                setIntervalHours(e.target.value);
                setTouchedInterval(true);
              }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">分钟</label>
            <Input
              type="number"
              min="0"
              placeholder="0"
              value={intervalMinutes}
              onChange={(e) => {
                setIntervalMinutes(e.target.value);
                setTouchedInterval(true);
              }}
            />
          </div>
        </div>
      )}

      {triggerType === "date" && (
        <div>
          <label className="mb-1.5 block text-sm font-medium">执行时间 *</label>
          <Input
            placeholder="2026-06-10T15:00:00+08:00"
            value={runAt}
            onChange={(e) => {
              setRunAt(e.target.value);
              setTouchedDate(true);
            }}
            className="font-mono"
            required
          />
          <p className="mt-1 text-xs text-muted-foreground">
            ISO 8601 格式，建议带时区偏移
          </p>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium">任务类型</label>
        <Select
          options={TASK_TYPE_OPTIONS}
          value={taskType}
          onChange={(e) => setTaskType(e.target.value as ScheduleTaskType)}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">任务配置 (JSON)</label>
        <textarea
          className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder='{"prompt": "..."}'
          value={taskConfig}
          onChange={(e) => {
            setTaskConfig(e.target.value);
            setTouchedTaskConfig(true);
          }}
        />
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button type="submit" disabled={submitDisabled}>
          {isPending
            ? isEditMode
              ? "保存中..."
              : "创建中..."
            : isEditMode
              ? "保存"
              : "创建调度"}
        </Button>
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          操作失败：{String(error)}
        </p>
      )}
    </form>
  );
}
