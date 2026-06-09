"use client";

import { useState, useEffect } from "react";
import { Button, Input, Select } from "@lark2codex/ui";
import {
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
} from "@lark2codex/core";
import type { Schedule, CreateScheduleInput } from "@lark2codex/core";

const TASK_TYPE_OPTIONS = [
  { label: "任务 (Task)", value: "task" },
  { label: "计划 (Plan)", value: "plan" },
];

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !cronExpr.trim()) return;

    let config: Record<string, any>;
    try {
      config = JSON.parse(taskConfig);
    } catch {
      alert("task_config 不是有效的 JSON");
      return;
    }

    const params: CreateScheduleInput = {
      name: name.trim(),
      cron_expr: cronExpr.trim(),
      task_type: taskType,
      task_config: config,
    };

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
        <label className="mb-1.5 block text-sm font-medium">
          Cron 表达式 *
        </label>
        <Input
          placeholder="如: 0 9 * * * (每天9点)"
          value={cronExpr}
          onChange={(e) => setCronExpr(e.target.value)}
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
        <label className="mb-1.5 block text-sm font-medium">任务类型</label>
        <Select
          options={TASK_TYPE_OPTIONS}
          value={taskType}
          onChange={(e) => setTaskType(e.target.value)}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">任务配置 (JSON)</label>
        <textarea
          className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder='{"prompt": "..."}'
          value={taskConfig}
          onChange={(e) => setTaskConfig(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button
          type="submit"
          disabled={isPending || !name.trim() || !cronExpr.trim()}
        >
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
