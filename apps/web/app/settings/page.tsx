"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@tide/core";
import {
  Users,
  ShieldCheck,
  ChevronRight,
  Lock,
  Sparkles,
  Scale,
  Webhook,
  BrainCircuit,
  Bot,
  Columns3,
  type LucideIcon,
} from "lucide-react";

interface SettingItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Roles allowed to see this entry. Empty = open to everyone. */
  allowedRoles?: string[];
}

const ITEMS: SettingItem[] = [
  {
    href: "/settings/users",
    label: "用户管理",
    description: "管理工作台账号、角色权限与登录凭据",
    icon: Users,
    allowedRoles: ["admin"],
  },
  {
    href: "/settings/freeform-status",
    label: "Freeform 状态列管理",
    description: "配置全局自由协作看板的状态列顺序与显示名称",
    icon: Columns3,
    allowedRoles: ["admin"],
  },
  {
    href: "/settings/agents",
    label: "Agent 管理",
    description: "管理本地和远程 Agent 配置、注册新 Agent、测试连通性",
    icon: Bot,
  },
  {
    href: "/settings/skills",
    label: "技能库",
    description: "管理 Agent 技能指南",
    icon: Sparkles,
  },
  {
    href: "/settings/rules",
    label: "规则引擎",
    description: "管理代码规范约束规则",
    icon: Scale,
  },
  {
    href: "/settings/expert-teams",
    label: "专家团",
    description: "管理领域专家配置",
    icon: BrainCircuit,
  },
  {
    href: "/settings/hooks",
    label: "事件钩子",
    description: "配置自动化触发操作",
    icon: Webhook,
  },
  {
    href: "/settings/security",
    label: "安全审查",
    description: "安全规则与扫描结果",
    icon: ShieldCheck,
  },
];

export default function SettingsHomePage() {
  const router = useRouter();
  const { user, hydrated, authRequired, isAuthenticated } = useAuth();

  // Lightweight auth gate – the AppShell already handles unauthenticated redirects
  // when authRequired is on, but we also stop non-admins from poking around.
  useEffect(() => {
    if (!hydrated) return;
    if (authRequired && !isAuthenticated) return; // app-shell will redirect
  }, [hydrated, authRequired, isAuthenticated]);

  const role = user?.role ?? null;
  const visibleItems = ITEMS.filter((item) => {
    if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
    return role ? item.allowedRoles.includes(role) : false;
  });

  return (
    <main className="mx-auto max-w-5xl px-2 py-2 space-y-8">
      <header>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="uppercase tracking-wider">SYSTEM · SETTINGS</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理工作台的账号、权限与全局偏好。仅管理员可见受控选项。
        </p>
      </header>

      {visibleItems.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card border border-border/50 px-6 py-16 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />
          <p className="mt-3 text-base font-medium">暂无可访问的设置项</p>
          <p className="mt-1 text-sm text-muted-foreground">
            当前账号 ({role ?? "guest"}) 没有访问任何设置区块的权限。
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-smooth"
          >
            ← 返回工作台
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group relative bg-card rounded-xl shadow-card border border-border/50 p-5 transition-smooth hover:shadow-card-hover hover:border-foreground/20"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/15 to-indigo-500/5 text-indigo-500">
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-base font-medium tracking-tight">
                        {item.label}
                      </h3>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-smooth group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
                {item.allowedRoles?.includes("admin") && (
                  <span className="mt-4 inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-500">
                    <ShieldCheck className="h-3 w-3" />
                    Admin
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
