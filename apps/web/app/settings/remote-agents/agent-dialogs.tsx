"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@tide/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
} from "@tide/ui";
import {
  AlertTriangle,
  Compass,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { RemoteAgent, RemoteAgentSkill } from "./page";

// ── Form value ───────────────────────────────────────────────────────────

export interface AgentFormValue {
  name: string;
  description: string;
  agent_card_url: string;
  endpoint_url: string;
  auth_type: string;
  auth_credentials: string;
  auth_header_name: string;
  approval_policy: string;
  timeout_ms: number;
  max_retries: number;
  scope: string;
  scope_target: string;
}

const DEFAULT_VALUE: AgentFormValue = {
  name: "",
  description: "",
  agent_card_url: "",
  endpoint_url: "",
  auth_type: "bearer",
  auth_credentials: "",
  auth_header_name: "",
  approval_policy: "on-request",
  timeout_ms: 300000,
  max_retries: 2,
  scope: "global",
  scope_target: "",
};

const AUTH_OPTIONS = [
  { value: "none", label: "无认证 (none)" },
  { value: "bearer", label: "Bearer Token" },
  { value: "api-key", label: "API Key (自定义请求头)" },
  { value: "basic", label: "Basic Auth" },
];

const POLICY_OPTIONS = [
  { value: "always", label: "始终审批 (always)" },
  { value: "on-request", label: "按需审批 (on-request)" },
  { value: "never", label: "无需审批 (never)" },
];

const SCOPE_OPTIONS = [
  { value: "global", label: "全局" },
  { value: "project", label: "项目" },
  { value: "personal", label: "个人" },
];

interface ProjectOption {
  id: string;
  name: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getApiErrorMessage(err: unknown): string {
  if (!err) return "未知错误";
  const e = err as { body?: unknown; message?: string };
  if (e.body && typeof e.body === "object") {
    const detail = (e.body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  if (err instanceof Error) return err.message;
  return e.message ?? String(err);
}

function fromAgent(agent: RemoteAgent | null): AgentFormValue {
  if (!agent) return { ...DEFAULT_VALUE };
  return {
    name: agent.name ?? "",
    description: agent.description ?? "",
    agent_card_url: agent.agent_card_url ?? "",
    endpoint_url: agent.endpoint_url ?? "",
    auth_type: agent.auth_type || "bearer",
    auth_credentials: agent.auth_credentials ?? "",
    auth_header_name: agent.auth_header_name ?? "",
    approval_policy: agent.approval_policy || "on-request",
    timeout_ms:
      typeof agent.timeout_ms === "number" ? agent.timeout_ms : 300000,
    max_retries:
      typeof agent.max_retries === "number" ? agent.max_retries : 2,
    scope: agent.scope || "global",
    scope_target: agent.scope_target ?? "",
  };
}

// ── Field primitive ──────────────────────────────────────────────────────

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-sm font-medium text-foreground">
        <span>
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </span>
        {hint && (
          <span className="text-[11px] font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

// ── Discover result ──────────────────────────────────────────────────────

interface DiscoverResult {
  url: string;
  name: string | null;
  description: string | null;
  endpoint_url: string | null;
  skills: RemoteAgentSkill[];
  capabilities: { streaming?: boolean; pushNotifications?: boolean };
}

// ── Add/Edit dialog ──────────────────────────────────────────────────────

export function AgentFormDialog({
  mode,
  open,
  onOpenChange,
  initial,
  onSubmit,
  discover,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: RemoteAgent | null;
  onSubmit: (value: AgentFormValue) => Promise<void>;
  discover: (url: string) => Promise<DiscoverResult>;
}) {
  const [value, setValue] = useState<AgentFormValue>(DEFAULT_VALUE);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoverResult | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.get<{ projects?: ProjectOption[] }>(
          "/api/projects?workspace_id=default",
        );
        const list = data?.projects || (Array.isArray(data) ? (data as ProjectOption[]) : []);
        if (!cancelled) {
          setProjects(list.map((p) => ({ id: p.id, name: p.name })));
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setValue(fromAgent(initial ?? null));
      setError(null);
      setDiscovered(null);
      setDiscovering(false);
      setSubmitting(false);
    }
  }, [open, initial]);

  const setField = <K extends keyof AgentFormValue>(
    key: K,
    val: AgentFormValue[K],
  ) => setValue((prev) => ({ ...prev, [key]: val }));

  const handleDiscover = async () => {
    const url = value.agent_card_url.trim();
    if (!url) {
      setError("请先输入 Agent Card URL");
      return;
    }
    setError(null);
    setDiscovering(true);
    try {
      const data = await discover(url);
      setDiscovered(data);
      setValue((prev) => ({
        ...prev,
        name: prev.name || data.name || "",
        description: prev.description || data.description || "",
        endpoint_url: data.endpoint_url || prev.endpoint_url,
      }));
    } catch (err) {
      setError(`发现失败：${getApiErrorMessage(err)}`);
    } finally {
      setDiscovering(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!value.name.trim()) {
      setError("名称必填");
      return;
    }
    if (!value.endpoint_url.trim() && !value.agent_card_url.trim()) {
      setError("端点 URL 或 Agent Card URL 至少填写一项");
      return;
    }
    if (!Number.isFinite(value.timeout_ms) || value.timeout_ms <= 0) {
      setError("超时时间必须为正整数（毫秒）");
      return;
    }
    if (!Number.isFinite(value.max_retries) || value.max_retries < 0) {
      setError("最大重试次数必须 ≥ 0");
      return;
    }
    if (value.scope === "project" && !value.scope_target) {
      setError("请选择一个项目");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...value,
        name: value.name.trim(),
        description: value.description.trim(),
        agent_card_url: value.agent_card_url.trim(),
        endpoint_url: value.endpoint_url.trim(),
        auth_credentials: value.auth_credentials.trim(),
        auth_header_name: value.auth_header_name.trim(),
        scope_target: value.scope === "project" ? value.scope_target : "",
      });
    } catch (err) {
      // Parent already toasts; surface inline message too.
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const skillsPreview = useMemo<RemoteAgentSkill[]>(() => {
    if (discovered?.skills && discovered.skills.length) return discovered.skills;
    if (mode === "edit" && initial?.skills) return initial.skills;
    return [];
  }, [discovered, initial, mode]);

  const showAuthHeaderName = value.auth_type === "api-key";
  const showCredentials = value.auth_type !== "none";
  const scopeInvalid = value.scope === "project" && !value.scope_target;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background/95 backdrop-blur-xl max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "注册远程 Agent" : "编辑远程 Agent"}
          </DialogTitle>
          <DialogDescription>
            通过 A2A 协议接入外部 Agent。可输入 Agent Card URL 自动发现元信息，
            或直接填写端点 URL 手动配置。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* Discover row */}
          <Field
            label="Agent Card URL"
            hint="例如 https://agent.example.com/.well-known/agent.json"
          >
            <div className="flex items-center gap-2">
              <Input
                placeholder="https://…/.well-known/agent.json"
                value={value.agent_card_url}
                onChange={(e) => setField("agent_card_url", e.target.value)}
                className="rounded-lg border-border/50 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDiscover()}
                disabled={discovering || !value.agent_card_url.trim()}
                className="shrink-0 gap-1.5"
              >
                {discovering ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Compass className="h-4 w-4" />
                )}
                发现
              </Button>
            </div>
          </Field>

          {discovered && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-700 dark:text-emerald-400">
              <div className="flex items-center gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                已从 Agent Card 自动填充
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                <div>
                  streaming:{" "}
                  {discovered.capabilities?.streaming ? "yes" : "no"}
                </div>
                <div>
                  push:{" "}
                  {discovered.capabilities?.pushNotifications ? "yes" : "no"}
                </div>
                <div>skills: {discovered.skills?.length ?? 0}</div>
                <div className="truncate" title={discovered.endpoint_url ?? ""}>
                  endpoint: {discovered.endpoint_url ?? "—"}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="名称" required>
              <Input
                placeholder="例如 Reviewer Agent"
                value={value.name}
                onChange={(e) => setField("name", e.target.value)}
                className="rounded-lg border-border/50"
              />
            </Field>
            <Field label="审批策略">
              <Select
                value={value.approval_policy}
                onChange={(e) => setField("approval_policy", e.target.value)}
                options={POLICY_OPTIONS}
                className="rounded-lg border-border/50"
              />
            </Field>
          </div>

          <Field label="描述">
            <Input
              placeholder="简短描述该 Agent 的能力"
              value={value.description}
              onChange={(e) => setField("description", e.target.value)}
              className="rounded-lg border-border/50"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="作用域"
              hint="全局/项目/个人"
            >
              <Select
                value={value.scope}
                onChange={(e) => {
                  const v = e.target.value;
                  setValue((prev) => ({
                    ...prev,
                    scope: v,
                    scope_target: v === "project" ? prev.scope_target : "",
                  }));
                }}
                options={SCOPE_OPTIONS}
                className="rounded-lg border-border/50"
              />
            </Field>
            {value.scope === "project" && (
              <Field label="项目" required>
                <Select
                  value={value.scope_target}
                  onChange={(e) => setField("scope_target", e.target.value)}
                  options={[
                    { value: "", label: "选择项目…" },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  className={`rounded-lg border-border/50 ${
                    scopeInvalid ? "border-destructive" : ""
                  }`}
                />
              </Field>
            )}
          </div>

          <Field label="端点 URL" required hint="支持发现后自动填充">
            <Input
              placeholder="https://agent.example.com/a2a"
              value={value.endpoint_url}
              onChange={(e) => setField("endpoint_url", e.target.value)}
              className="rounded-lg border-border/50 font-mono text-xs"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="认证方式">
              <Select
                value={value.auth_type}
                onChange={(e) => setField("auth_type", e.target.value)}
                options={AUTH_OPTIONS}
                className="rounded-lg border-border/50"
              />
            </Field>
            {showAuthHeaderName && (
              <Field label="请求头名称" hint="例如 X-API-Key">
                <Input
                  placeholder="X-API-Key"
                  value={value.auth_header_name}
                  onChange={(e) =>
                    setField("auth_header_name", e.target.value)
                  }
                  className="rounded-lg border-border/50 font-mono text-xs"
                />
              </Field>
            )}
          </div>

          {showCredentials && (
            <Field
              label="凭据"
              hint={
                value.auth_type === "basic"
                  ? "格式：username:password"
                  : "Token 或 API Key"
              }
            >
              <Input
                type="password"
                placeholder="••••••••"
                value={value.auth_credentials}
                onChange={(e) => setField("auth_credentials", e.target.value)}
                className="rounded-lg border-border/50 font-mono text-xs"
              />
            </Field>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="超时 (毫秒)" hint="默认 300000">
              <Input
                type="number"
                min={1000}
                step={1000}
                value={value.timeout_ms}
                onChange={(e) =>
                  setField("timeout_ms", Number(e.target.value) || 0)
                }
                className="rounded-lg border-border/50 font-mono text-xs"
              />
            </Field>
            <Field label="最大重试次数" hint="默认 2">
              <Input
                type="number"
                min={0}
                step={1}
                value={value.max_retries}
                onChange={(e) =>
                  setField("max_retries", Number(e.target.value) || 0)
                }
                className="rounded-lg border-border/50 font-mono text-xs"
              />
            </Field>
          </div>

          {skillsPreview.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                技能（{skillsPreview.length}）
              </div>
              <div className="flex flex-wrap gap-1.5">
                {skillsPreview.slice(0, 12).map((skill, idx) => {
                  const label =
                    skill.name ||
                    skill.id ||
                    `skill-${idx + 1}`;
                  return (
                    <span
                      key={`${label}-${idx}`}
                      className="inline-flex items-center rounded-md border border-border/50 bg-background px-2 py-0.5 text-[11px] font-mono"
                      title={skill.description ?? label}
                    >
                      {label}
                    </span>
                  );
                })}
                {skillsPreview.length > 12 && (
                  <span className="text-[11px] text-muted-foreground">
                    +{skillsPreview.length - 12} more
                  </span>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting
              ? mode === "create"
                ? "注册中…"
                : "保存中…"
              : mode === "create"
                ? "注册"
                : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Confirm delete dialog ────────────────────────────────────────────────

export function ConfirmDeleteDialog({
  agent,
  onClose,
  onConfirm,
}: {
  agent: RemoteAgent | null;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (agent) {
      setConfirmText("");
      setBusy(false);
    }
  }, [agent]);

  const canConfirm = !!agent && confirmText.trim() === agent.name;

  const handle = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!agent} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" /> 删除远程 Agent
          </DialogTitle>
          <DialogDescription>
            该操作不可撤销。已绑定到工作流的 Agent 节点在删除后将无法解析。
          </DialogDescription>
        </DialogHeader>

        {agent && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <div>
                    即将删除
                    <code className="mx-1 rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                      {agent.name}
                    </code>
                    （{agent.id}）
                  </div>
                  {agent.endpoint_url && (
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {agent.endpoint_url}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <Field label={`请输入名称「${agent.name}」以确认`}>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={agent.name}
                className="rounded-lg border-border/50 font-mono"
              />
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || busy}
            onClick={() => void handle()}
          >
            {busy ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
