"use client";

import { useState } from "react";
import { Button } from "@tide/ui";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tide/ui";
import { useSchedulesQuery } from "@tide/core";
import { ScheduleList, ScheduleForm, ScheduleGuide } from "@tide/views";
import type { Schedule } from "@tide/core";

export default function SchedulesPage() {
  const [showDialog, setShowDialog] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const { data, isLoading, isError } = useSchedulesQuery();

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
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">定时调度</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            创建和管理定时调度任务
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScheduleGuide />
          <Button onClick={openCreate}>+ 创建调度</Button>
        </div>
      </div>

      {/* Schedule List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">调度列表</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">
              加载中...
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-destructive">
              加载失败，请重试
            </div>
          ) : (
            <ScheduleList
              items={data?.items ?? []}
              onEdit={openEdit}
            />
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editingSchedule ? "编辑调度" : "创建调度"}
              </h2>
              <Button variant="ghost" size="sm" onClick={closeDialog}>
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
    </main>
  );
}
