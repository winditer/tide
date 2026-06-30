"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  toast,
} from "@tide/ui";
import {
  useAdminUsers,
  useAuth,
  useCreateAdminUser,
  useDeleteAdminUser,
  useResetUserPassword,
  useUpdateAdminUser,
  type AdminUser,
} from "@tide/core";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  KeyRound,
  PenLine,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { ProjectAssignDialog } from "./project-assign-dialog";

const ROLE_OPTIONS = [
  { value: "admin", label: "管理员 (admin)" },
  { value: "member", label: "成员 (member)" },
  { value: "viewer", label: "只读 (viewer)" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "启用" },
  { value: "disabled", label: "禁用" },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  member: "成员",
  viewer: "只读",
};

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  admin: "default",
  member: "secondary",
  viewer: "outline",
};

function formatTime(iso: string | null | undefined) {
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

function getApiErrorMessage(err: unknown): string {
  if (!err) return "未知错误";
  // ApiError surface
  const e = err as { body?: unknown; message?: string };
  if (e.body && typeof e.body === "object") {
    const detail = (e.body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return e.message ?? String(err);
}

export default function SettingsUsersPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
      }
    >
      <UsersPageContent />
    </Suspense>
  );
}

function UsersPageContent() {
  const router = useRouter();
  const { user, hydrated } = useAuth();
  const isAdmin = user?.role === "admin";

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Real-time search with light debounce
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, isError, error } = useAdminUsers({
    q: debounced || undefined,
    page,
    page_size: pageSize,
  });

  const createMutation = useCreateAdminUser();
  const updateMutation = useUpdateAdminUser();
  const deleteMutation = useDeleteAdminUser();
  const resetMutation = useResetUserPassword();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [assigningProjects, setAssigningProjects] = useState<AdminUser | null>(
    null,
  );

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.page_size));
  }, [data]);

  if (hydrated && !isAdmin) {
    return (
      <main className="mx-auto max-w-3xl px-2 py-12">
        <div className="bg-card rounded-xl shadow-card border border-destructive/30 p-8 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" strokeWidth={1.5} />
          <h2 className="mt-3 text-lg font-semibold">无访问权限</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            用户管理仅对管理员开放。当前角色：
            <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {user?.role ?? "guest"}
            </code>
          </p>
          <Button variant="outline" className="mt-6" onClick={() => router.push("/settings")}>
            ← 返回设置
          </Button>
        </div>
      </main>
    );
  }

  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  return (
    <main className="mx-auto max-w-7xl px-2 py-2 space-y-6">
      {/* Header */}
      <header className="space-y-3">
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-smooth"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回设置
        </button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>ADMIN · USERS</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">用户管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {total} 个账号 · 创建、停用、重置密码与角色调整
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <UserPlus className="h-4 w-4" /> 新建用户
            </Button>
          </div>
        </div>
      </header>

      {/* Search bar */}
      <div className="bg-card rounded-xl shadow-card border border-border/50 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索用户名 / 邮箱 / 显示名称…"
            className="pl-9 rounded-lg border-border/50 focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Table */}
      <section className="bg-card rounded-xl shadow-card overflow-hidden border border-border/50">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : isError ? (
          <div className="py-16 text-center text-sm text-destructive">
            加载失败：{getApiErrorMessage(error)}
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {debounced ? "未找到匹配的用户" : "暂无用户"}
            </p>
            {!debounced && (
              <Button className="mt-5 gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> 创建第一个用户
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">用户名</th>
                  <th className="px-4 py-3 font-medium">显示名称</th>
                  <th className="px-4 py-3 font-medium">邮箱</th>
                  <th className="px-4 py-3 font-medium">角色</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">创建时间</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {users.map((u) => {
                  const isSelf = user?.id === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-muted/40 transition-smooth">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 text-[11px] font-semibold uppercase text-indigo-500">
                            {(u.username || "?").slice(0, 2)}
                          </div>
                          <span className="font-medium">{u.username}</span>
                          {isSelf && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                              ME
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {u.display_name || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {u.email || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={ROLE_VARIANT[u.role] ?? "outline"}>
                          {ROLE_LABEL[u.role] ?? u.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {u.status === "disabled" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
                            已禁用
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            启用
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatTime(u.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditing(u)}
                            title="编辑"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
                          >
                            <PenLine className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssigningProjects(u)}
                            title="管理项目"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-indigo-500/10 hover:text-indigo-500"
                          >
                            <FolderKanban className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setResetting(u)}
                            title="重置密码"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => setDeleting(u)}
                            title={isSelf ? "不能删除自己" : "删除"}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {users.length > 0 && (
          <div className="flex items-center justify-between border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
            <span>
              第 {(page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, total)} 条 / 共 {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-xs transition-smooth hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> 上一页
              </button>
              <span className="font-mono">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-xs transition-smooth hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
              >
                下一页 <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Create dialog */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        isPending={createMutation.isPending}
        onSubmit={async (input) => {
          try {
            await createMutation.mutateAsync(input);
            toast({ title: "已创建用户", description: input.username });
            setCreateOpen(false);
          } catch (err) {
            toast({
              title: "创建失败",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
          }
        }}
      />

      {/* Edit dialog */}
      <EditUserDialog
        user={editing}
        onClose={() => setEditing(null)}
        isPending={updateMutation.isPending}
        disableSelfFields={editing?.id === user?.id}
        onSubmit={async (body) => {
          if (!editing) return;
          try {
            await updateMutation.mutateAsync({ userId: editing.id, body });
            setEditing(null);
          } catch (err) {
            toast({
              title: "保存失败",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
          }
        }}
      />

      {/* Reset password dialog */}
      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
        isPending={resetMutation.isPending}
        onSubmit={async (newPassword) => {
          if (!resetting) return;
          try {
            await resetMutation.mutateAsync({
              userId: resetting.id,
              newPassword,
            });
            toast({
              title: "密码已重置",
              description: `${resetting.username} 的所有活跃会话已注销`,
            });
            setResetting(null);
          } catch (err) {
            toast({
              title: "重置失败",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
          }
        }}
      />

      {/* Project assignment dialog */}
      <ProjectAssignDialog
        user={assigningProjects}
        onClose={() => setAssigningProjects(null)}
      />

      {/* Delete dialog */}
      <ConfirmDeleteDialog
        user={deleting}
        onClose={() => setDeleting(null)}
        isPending={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteMutation.mutateAsync(deleting.id);
            toast({ title: "已删除用户", description: deleting.username });
            setDeleting(null);
          } catch (err) {
            toast({
              title: "删除失败",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
          }
        }}
      />
    </main>
  );
}

// ── Dialogs ───────────────────────────────────────────────────────────────

function CreateUserDialog({
  open,
  onOpenChange,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isPending: boolean;
  onSubmit: (input: {
    username: string;
    password: string;
    email?: string;
    role?: string;
    display_name?: string;
  }) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      setEmail("");
      setRole("member");
      setDisplayName("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    if (!username.trim()) return setError("用户名必填");
    if (!password.trim()) return setError("密码必填");
    await onSubmit({
      username: username.trim(),
      password,
      email: email.trim() || undefined,
      role,
      display_name: displayName.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle>新建用户</DialogTitle>
          <DialogDescription>
            创建工作台账号。密码将以哈希形式存储。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="用户名" required>
            <Input
              autoFocus
              placeholder="登录名（唯一）"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded-lg border-border/50"
            />
          </Field>
          <Field label="密码" required>
            <Input
              type="password"
              placeholder="初始密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border-border/50 font-mono"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="角色">
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                options={ROLE_OPTIONS}
                className="rounded-lg border-border/50"
              />
            </Field>
            <Field label="显示名称">
              <Input
                placeholder="默认使用用户名"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="rounded-lg border-border/50"
              />
            </Field>
          </div>
          <Field label="邮箱（可选）">
            <Input
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border-border/50"
            />
          </Field>
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
          <Button disabled={isPending} onClick={submit}>
            {isPending ? "创建中…" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  isPending,
  disableSelfFields,
  onSubmit,
}: {
  user: AdminUser | null;
  onClose: () => void;
  isPending: boolean;
  disableSelfFields: boolean;
  onSubmit: (body: {
    email?: string;
    role?: string;
    display_name?: string;
    status?: string;
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setEmail(user.email ?? "");
      setRole(user.role ?? "member");
      setDisplayName(user.display_name ?? "");
      setStatus(user.status ?? "active");
      setError(null);
    }
  }, [user]);

  const submit = async () => {
    if (!user) return;
    setError(null);
    const body: {
      email?: string;
      role?: string;
      display_name?: string;
      status?: string;
    } = {};
    const trimmedEmail = email.trim();
    if (trimmedEmail !== (user.email ?? "")) body.email = trimmedEmail || undefined;
    if (displayName.trim() !== (user.display_name ?? "")) {
      body.display_name = displayName.trim();
    }
    if (!disableSelfFields) {
      if (role !== user.role) body.role = role;
      if (status !== (user.status ?? "active")) body.status = status;
    }
    if (Object.keys(body).length === 0) {
      setError("没有任何字段被修改");
      return;
    }
    await onSubmit(body);
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle>编辑用户</DialogTitle>
          <DialogDescription>
            {user ? `修改 ${user.username} 的角色与档案。` : ""}
          </DialogDescription>
        </DialogHeader>

        {user && (
          <div className="space-y-4">
            <Field label="显示名称">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="rounded-lg border-border/50"
              />
            </Field>
            <Field label="邮箱">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="rounded-lg border-border/50"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="角色"
                hint={disableSelfFields ? "不能修改自己的角色" : undefined}
              >
                <Select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  options={ROLE_OPTIONS}
                  disabled={disableSelfFields}
                  className="rounded-lg border-border/50"
                />
              </Field>
              <Field
                label="状态"
                hint={disableSelfFields ? "不能禁用自己" : undefined}
              >
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  options={STATUS_OPTIONS}
                  disabled={disableSelfFields}
                  className="rounded-lg border-border/50"
                />
              </Field>
            </div>
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={isPending} onClick={submit}>
            {isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  isPending,
  onSubmit,
}: {
  user: AdminUser | null;
  onClose: () => void;
  isPending: boolean;
  onSubmit: (newPassword: string) => Promise<void>;
}) {
  const [pwd, setPwd] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setPwd("");
      setConfirmText("");
      setError(null);
    }
  }, [user]);

  const submit = async () => {
    setError(null);
    if (!pwd) return setError("新密码必填");
    if (pwd !== confirmText) return setError("两次输入的密码不一致");
    await onSubmit(pwd);
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> 重置密码
          </DialogTitle>
          <DialogDescription>
            {user ? (
              <>
                将为
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {user.username}
                </code>
                设置新密码，并立即注销其全部活跃会话。
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="新密码" required>
            <Input
              type="password"
              autoFocus
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="rounded-lg border-border/50 font-mono"
            />
          </Field>
          <Field label="确认新密码" required>
            <Input
              type="password"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="rounded-lg border-border/50 font-mono"
            />
          </Field>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={isPending} onClick={submit}>
            {isPending ? "提交中…" : "重置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDeleteDialog({
  user,
  onClose,
  isPending,
  onConfirm,
}: {
  user: AdminUser | null;
  onClose: () => void;
  isPending: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (user) setConfirmText("");
  }, [user]);

  const canConfirm = !!user && confirmText === user.username;

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" /> 删除用户
          </DialogTitle>
          <DialogDescription>
            该操作不可撤销。用户的所有会话与项目成员记录都会被清理。
          </DialogDescription>
        </DialogHeader>

        {user && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
              即将删除
              <code className="mx-1 rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                {user.username}
              </code>
              （{user.display_name || user.email || "—"}）
            </div>
            <Field label={`请输入用户名「${user.username}」以确认`}>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={user.username}
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
            disabled={!canConfirm || isPending}
            onClick={onConfirm}
          >
            {isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
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
          <span className="text-[11px] font-normal text-muted-foreground">{hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}
