"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAuth,
  useGlobalFreeformStatusList,
  useSetGlobalFreeformStatusList,
  type FreeformStatusItem,
} from "@tide/core";
import { Button, Input, toast } from "@tide/ui";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Columns3,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";

export default function FreeformStatusSettingsPage() {
  const router = useRouter();
  const { user, hydrated } = useAuth();
  const role = user?.role ?? null;
  const isAdmin = role === "admin";

  const query = useGlobalFreeformStatusList();
  const saveMutation = useSetGlobalFreeformStatusList();
  const [list, setList] = useState<FreeformStatusItem[]>([]);

  // 后端数据加载后同步到本地可编辑状态
  useEffect(() => {
    if (query.data) setList(query.data);
  }, [query.data]);

  const updateLabel = (index: number, label: string) => {
    setList((prev) => prev.map((it, i) => (i === index ? { ...it, label } : it)));
  };

  const updateKey = (index: number, key: string) => {
    setList((prev) => prev.map((it, i) => (i === index ? { ...it, key } : it)));
  };

  const removeItem = (index: number) => {
    setList((prev) => prev.filter((_, i) => i !== index));
  };

  const moveItem = (index: number, dir: -1 | 1) => {
    setList((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addItem = () => {
    setList((prev) => [
      ...prev,
      { key: `status_${prev.length + 1}`, label: "新状态" },
    ]);
  };

  const handleSave = () => {
    // 校验：key 不能为空且不重复
    const cleaned = list
      .map((it) => ({ key: it.key.trim(), label: it.label.trim() }))
      .filter((it) => it.key);
    const keys = cleaned.map((it) => it.key);
    if (new Set(keys).size !== keys.length) {
      toast({ title: "状态 key 不能重复", variant: "destructive" });
      return;
    }
    if (!cleaned.some((it) => it.key === "completed")) {
      toast({ title: '必须保留终态列 "completed"', variant: "destructive" });
      return;
    }
    saveMutation.mutate(cleaned, {
      onSuccess: (data) => {
        setList(data);
        toast({ title: "全局状态列已保存" });
      },
      onError: () => toast({ title: "保存失败", variant: "destructive" }),
    });
  };

  if (hydrated && !isAdmin) {
    return (
      <main className="mx-auto max-w-3xl px-2 py-2">
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-smooth"
        >
          <ArrowLeft className="h-4 w-4" />
          返回设置
        </button>
        <div className="bg-card rounded-xl shadow-card border border-border/50 px-6 py-16 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />
          <p className="mt-3 text-base font-medium">无权访问</p>
          <p className="mt-1 text-sm text-muted-foreground">
            仅管理员可配置全局 Freeform 状态列。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-2 py-2 space-y-6">
      <button
        type="button"
        onClick={() => router.push("/settings")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-smooth"
      >
        <ArrowLeft className="h-4 w-4" />
        返回设置
      </button>

      <header>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Columns3 className="h-3.5 w-3.5" />
          <span className="uppercase tracking-wider">SYSTEM · FREEFORM STATUS</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Freeform 状态列管理
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配置全局自由协作看板的状态列。未做项目级配置的项目将使用此全局配置。终态列
          “completed” 必须保留。
        </p>
      </header>

      <div className="bg-card rounded-xl shadow-card p-6 space-y-4">
        {query.isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="上移"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, 1)}
                    disabled={index === list.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="下移"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <Input
                  value={item.key}
                  onChange={(e) => updateKey(index, e.target.value)}
                  placeholder="key"
                  className="w-40 font-mono text-xs"
                  disabled={item.key === "completed"}
                />
                <Input
                  value={item.label}
                  onChange={(e) => updateLabel(index, e.target.value)}
                  placeholder="显示名称"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeItem(index)}
                  disabled={item.key === "completed"}
                  aria-label="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus className="mr-1 h-4 w-4" />
                添加状态
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
