"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@tide/core";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tide/ui";
import { UserCog, Bell, KeyRound, Terminal } from "lucide-react";
import { ProfileTab } from "./profile-tab";
import { NotificationsTab } from "./notifications-tab";
import { DaemonTokensTab } from "./daemon-tokens-tab";
import { ApiTokensTab } from "./api-tokens-tab";

export default function ProfilePage() {
  const router = useRouter();
  const { isAuthenticated, hydrated, authRequired } = useAuth();

  // 未登录用户重定向到登录页。等待 hydrated 完成避免首屏闪烁。
  useEffect(() => {
    if (!hydrated) return;
    if (authRequired && !isAuthenticated) {
      router.replace("/auth/login");
    }
  }, [hydrated, authRequired, isAuthenticated, router]);

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-4xl px-2 py-16 text-center text-sm text-muted-foreground">
        加载中…
      </main>
    );
  }

  if (authRequired && !isAuthenticated) {
    return (
      <main className="mx-auto max-w-4xl px-2 py-16 text-center text-sm text-muted-foreground">
        正在跳转登录…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-2 py-2 space-y-6">
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <UserCog className="h-3.5 w-3.5" />
          <span>ACCOUNT · PROFILE</span>
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">个人设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理你的个人资料、通知偏好以及访问凭据。
        </p>
      </header>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="profile" className="gap-1.5">
            <UserCog className="h-4 w-4" /> 个人资料
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5">
            <Bell className="h-4 w-4" /> 通知
          </TabsTrigger>
          <TabsTrigger value="daemon-tokens" className="gap-1.5">
            <Terminal className="h-4 w-4" /> Daemon Token
          </TabsTrigger>
          <TabsTrigger value="api-tokens" className="gap-1.5">
            <KeyRound className="h-4 w-4" /> API Token
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="daemon-tokens">
          <DaemonTokensTab />
        </TabsContent>
        <TabsContent value="api-tokens">
          <ApiTokensTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}
