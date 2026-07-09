"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "@tide/core";
import {
  Button,
  Input,
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@tide/ui";
import { Plus, RotateCcw, Trash2, Copy, Check, KeyRound, ShieldAlert } from "lucide-react";

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

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CreatedToken {
  id: string;
  token: string;
  name: string;
  prefix: string;
  expires_at: string | null;
  created_at: string;
}

export function ApiTokensTab() {
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const [deleting, setDeleting] = useState<ApiTokenInfo | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const data = await apiClient.get<ApiTokenInfo[]>("/api/api-tokens");
      setTokens(data ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast({ title: "请填写名称", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const days = expiresDays.trim() ? Number(expiresDays.trim()) : undefined;
      const result = await apiClient.post<CreatedToken>("/api/api-tokens", {
        name: newName.trim(),
        ...(days && Number.isFinite(days) ? { expires_days: days } : {}),
      });
      setCreateOpen(false);
      setNewName("");
      setExpiresDays("");
      setCreated(result);
      setCopied(false);
      await reload();
    } catch (err) {
      toast({
        title: "创建失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await apiClient.del(`/api/api-tokens/${encodeURIComponent(deleting.id)}`);
      toast({ title: "已删除", description: deleting.name });
      setDeleting(null);
      await reload();
    } catch (err) {
      toast({
        title: "删除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const copyToken = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "复制失败", description: "请手动选择复制", variant: "destructive" });
    }
  };

  return (
    <section className="bg-card rounded-xl shadow-card border border-border/50 overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border/50 p-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">API Token</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            个人访问 Token 让外部集成可以代表你的账号进行身份验证。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => void reload()} className="gap-1.5">
            <RotateCcw className="h-4 w-4" /> 刷新
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> 生成新 Token
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
      ) : error ? (
        <div className="py-16 text-center text-sm text-destructive">加载失败：{error}</div>
      ) : tokens.length === 0 ? (
        <div className="py-16 text-center">
          <KeyRound className="mx-auto h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-muted-foreground">尚未生成任何 API Token</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">前缀</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium">最后使用</th>
                <th className="px-4 py-3 font-medium">过期时间</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {tokens.map((t) => (
                <tr key={t.id} className="hover:bg-muted/40 transition-smooth">
                  <td className="px-4 py-3 font-medium">{t.name || "—"}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {t.prefix}…
                    </code>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {formatTime(t.created_at)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {formatTime(t.last_used_at)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {t.expires_at ? formatTime(t.expires_at) : "永不过期"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setDeleting(t)}
                        title="删除"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 创建 Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>生成新 API Token</DialogTitle>
            <DialogDescription>为外部集成生成一个专属的访问 Token。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label htmlFor="api-token-name" className="block text-sm font-medium">名称</label>
              <Input
                id="api-token-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：ci-pipeline"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="api-token-expires" className="block text-sm font-medium">
                过期天数（可选）
              </label>
              <Input
                id="api-token-expires"
                type="number"
                min={1}
                value={expiresDays}
                onChange={(e) => setExpiresDays(e.target.value)}
                placeholder="留空表示永不过期"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 明文展示 Dialog（仅一次） */}
      <Dialog open={!!created} onOpenChange={(v) => { if (!v) setCreated(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token 创建成功</DialogTitle>
            <DialogDescription>
              请立即复制并妥善保存。出于安全考虑，此 Token 只显示这一次，关闭后将无法再次查看。
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/40 p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{created?.token}</code>
              <Button size="sm" variant="outline" onClick={() => void copyToken()} className="shrink-0 gap-1.5">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 Dialog */}
      <Dialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" /> 删除 Token
            </DialogTitle>
            <DialogDescription>
              确认删除 <span className="font-medium text-foreground">{deleting?.name}</span>？
              使用该 Token 的集成将立即失去访问权限，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
