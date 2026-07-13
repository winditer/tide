"use client";

import { useEffect, useState } from "react";
import { apiClient, ApiError, useAuth } from "@tide/core";
import { Button, toast } from "@tide/ui";
import { Save } from "lucide-react";

function getApiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: unknown } | null | undefined;
    if (body && typeof body === "object" && typeof body.detail === "string") {
      return body.detail;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err ?? "未知错误");
}

type NotificationPrefs = {
  web_enabled: boolean;
  email_enabled: boolean;
  task_complete: boolean;
  approval: boolean;
  lark_mention_enabled: boolean;
  lark_task_completed_enabled: boolean;
  lark_approval_enabled: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  web_enabled: true,
  email_enabled: false,
  task_complete: true,
  approval: true,
  lark_mention_enabled: true,
  lark_task_completed_enabled: true,
  lark_approval_enabled: true,
};

type PrefItem = { key: keyof NotificationPrefs; label: string; description: string };

const GENERAL_ITEMS: PrefItem[] = [
  { key: "web_enabled", label: "站内通知", description: "在工作台内接收通知提醒" },
  { key: "email_enabled", label: "邮件通知", description: "将通知同步发送到你的邮箱" },
  { key: "task_complete", label: "任务完成通知", description: "任务执行完成时通知你" },
  { key: "approval", label: "审批通知", description: "有审批请求需要处理时通知你" },
];

const LARK_ITEMS: PrefItem[] = [
  { key: "lark_mention_enabled", label: "Lark @提及通知", description: "当有人在评论中@您时，通过飞书向您发送通知" },
  { key: "lark_task_completed_enabled", label: "Lark 任务完成通知", description: "Agent任务完成时通过飞书发送通知" },
  { key: "lark_approval_enabled", label: "Lark 审批通知", description: "审批请求时通过飞书发送通知" },
];

/** Switch 组件（UI 包未提供，此处以原生按钮实现，风格与 shadcn 一致）。 */
function Toggle({
  checked,
  onChange,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${
        checked ? "bg-primary" : "bg-input"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function NotificationsTab() {
  const { user, refreshUser } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);

  const hasLarkBinding = Boolean(
    (user as { lark_open_id?: string | null } | null)?.lark_open_id
  );

  // 从 user.notification_prefs 读取（后端返回的用户对象上的 JSON 字段）
  useEffect(() => {
    const raw = (user as { notification_prefs?: Partial<NotificationPrefs> } | null)
      ?.notification_prefs;
    if (raw && typeof raw === "object") {
      setPrefs({ ...DEFAULT_PREFS, ...raw });
    }
  }, [user]);

  const update = (key: keyof NotificationPrefs, value: boolean) =>
    setPrefs((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.patch("/api/auth/profile", { notification_prefs: prefs });
      await refreshUser();
      toast({ title: "已保存", description: "通知偏好已更新" });
    } catch (err) {
      toast({
        title: "保存失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 通用通知偏好 */}
      <section className="bg-card rounded-xl shadow-card border border-border/50 p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">通知偏好</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            选择你希望接收的通知类型与渠道。
          </p>
        </div>

        <div className="divide-y divide-border/50">
          {GENERAL_ITEMS.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <label htmlFor={`pref-${item.key}`} className="block text-sm font-medium">
                  {item.label}
                </label>
                <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
              </div>
              <Toggle
                id={`pref-${item.key}`}
                checked={prefs[item.key]}
                onChange={(v) => update(item.key, v)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Lark 通知设置 */}
      <section className="bg-card rounded-xl shadow-card border border-border/50 p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Lark 通知设置</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            配置通过飞书接收的通知类型。
          </p>
        </div>

        {!hasLarkBinding && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900/50 dark:bg-yellow-950/30 p-3">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              请先绑定飞书账号以启用通知。绑定后即可使用下方的 Lark 通知开关。
            </p>
          </div>
        )}

        <div className="divide-y divide-border/50">
          {LARK_ITEMS.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <label htmlFor={`pref-${item.key}`} className="block text-sm font-medium">
                  {item.label}
                </label>
                <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
              </div>
              <Toggle
                id={`pref-${item.key}`}
                checked={prefs[item.key]}
                onChange={(v) => update(item.key, v)}
                disabled={!hasLarkBinding}
              />
            </div>
          ))}
        </div>
      </section>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={saving} className="gap-1.5">
          <Save className="h-4 w-4" />
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}
