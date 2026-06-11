"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@tide/ui";
import { useSchedulesQuery } from "@tide/core";
import { ScheduleList, ScheduleForm, ScheduleGuide } from "@tide/views";
import type { Schedule } from "@tide/core";

export default function SchedulesPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      }
    >
      <SchedulesPageContent />
    </Suspense>
  );
}

function SchedulesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showDialog, setShowDialog] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const handledActionRef = useRef(false);

  const { data, isLoading, isError } = useSchedulesQuery();

  // 首次进入时若 URL 携带 action=create 则自动打开创建弹窗
  useEffect(() => {
    if (handledActionRef.current) return;
    const action = searchParams.get("action");
    if (action === "create") {
      handledActionRef.current = true;
      setEditingSchedule(null);
      setShowDialog(true);
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("action");
      const qs = sp.toString();
      router.replace(qs ? `/schedules?${qs}` : "/schedules", { scroll: false });
    }
  }, [searchParams, router]);

  const openCreate = () => {
    setEditingSchedule(null);
    setShowDialog(true);
  };

  const openEdit = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingSchedule(null);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">定时调度</h1>
          <p className="text-sm text-muted-foreground mt-1">
            创建和管理定时调度任务。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScheduleGuide />
          <Button onClick={openCreate}>+ 创建调度</Button>
        </div>
      </header>

      {/* Schedule List */}
      <div className="bg-card rounded-xl shadow-card overflow-hidden hover:shadow-card-hover transition-smooth">
        <div className="border-b border-border/50 px-5 py-4">
          <h2 className="text-base font-semibold">调度列表</h2>
        </div>
        <div className="p-2">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              加载中...
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-sm text-destructive">
              加载失败，请重试
            </div>
          ) : (
            <ScheduleList
              items={data?.items ?? []}
              onEdit={openEdit}
            />
          )}
        </div>
      </div>

      {/* Create/Edit Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="mx-4 w-full max-w-lg bg-card rounded-xl shadow-card-hover p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                {editingSchedule ? "编辑调度" : "创建调度"}
              </h2>
              <Button variant="ghost" size="sm" onClick={closeDialog} className="transition-smooth">
                ✕
              </Button>
            </div>
            <ScheduleForm
              schedule={editingSchedule}
              onSuccess={closeDialog}
              onCancel={closeDialog}
            />
          </div>
        </div>
      )}
    </div>
  );
}
