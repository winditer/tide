"use client";

import { useEffect, useState } from "react";
import { apiClient, ApiError, useAuth } from "@tide/core";
import { Button, Input, toast } from "@tide/ui";
import { Save, KeyRound } from "lucide-react";

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

export function ProfileTab() {
  const { user, refreshUser } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // 用户信息就绪后回填表单
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setEmail(user.email ?? "");
    setAvatarUrl(user.avatar_url ?? "");
  }, [user]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await apiClient.patch("/api/auth/profile", {
        display_name: displayName,
        email: email || null,
        avatar_url: avatarUrl || null,
      });
      await refreshUser();
      toast({ title: "已保存", description: "个人资料已更新" });
    } catch (err) {
      toast({
        title: "保存失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      toast({ title: "请填写完整", description: "旧密码与新密码不能为空", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "两次密码不一致", description: "请确认新密码输入一致", variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    try {
      await apiClient.post("/api/auth/change-password", {
        old_password: oldPassword,
        new_password: newPassword,
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "密码已修改", description: "其他设备的登录会话已失效" });
    } catch (err) {
      toast({
        title: "修改失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const labelCls = "block text-sm font-medium text-foreground";
  const fieldWrap = "space-y-1.5";

  return (
    <div className="space-y-6">
      {/* 个人资料 */}
      <section className="bg-card rounded-xl shadow-card border border-border/50 p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">基本信息</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            用户名 <span className="font-mono">{user?.username ?? "—"}</span> 不可修改。
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className={fieldWrap}>
            <label htmlFor="display_name" className={labelCls}>显示名称</label>
            <Input
              id="display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="你的昵称"
            />
          </div>
          <div className={fieldWrap}>
            <label htmlFor="email" className={labelCls}>邮箱</label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className={`${fieldWrap} sm:col-span-2`}>
            <label htmlFor="avatar_url" className={labelCls}>头像 URL</label>
            <Input
              id="avatar_url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void handleSaveProfile()} disabled={savingProfile} className="gap-1.5">
            <Save className="h-4 w-4" />
            {savingProfile ? "保存中…" : "保存"}
          </Button>
        </div>
      </section>

      {/* 修改密码 */}
      <section className="bg-card rounded-xl shadow-card border border-border/50 p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">修改密码</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            修改成功后，其他设备上的登录会话将被强制失效。
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <div className={fieldWrap}>
            <label htmlFor="old_password" className={labelCls}>旧密码</label>
            <Input
              id="old_password"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className={fieldWrap}>
            <label htmlFor="new_password" className={labelCls}>新密码</label>
            <Input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className={fieldWrap}>
            <label htmlFor="confirm_password" className={labelCls}>确认新密码</label>
            <Input
              id="confirm_password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => void handleChangePassword()}
            disabled={changingPassword}
            className="gap-1.5"
          >
            <KeyRound className="h-4 w-4" />
            {changingPassword ? "提交中…" : "修改密码"}
          </Button>
        </div>
      </section>
    </div>
  );
}
