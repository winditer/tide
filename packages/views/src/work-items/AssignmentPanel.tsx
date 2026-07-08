"use client";

/**
 * 工作项分配面板 - 用于 freeform 模式下展示和管理分配。
 *
 * Features:
 * - 显示当前分配列表（成员头像 + 角色 + 状态标签）
 * - "分配"按钮弹出选择器（成员/团队/小队）
 * - Squad 视角：显示 leader 和已派遣成员 + 各自进度
 * - "接受任务"/"完成任务" 操作按钮
 */

import { useState } from "react";
import { UserPlus, Users, Shield, User } from "lucide-react";
import { Button, Input, Select } from "@tide/ui";
import type { WorkItemAssignment } from "@tide/core";

export interface AssignmentPanelProps {
  workItemId: string;
  assignments: WorkItemAssignment[];
  onAssign?: (targetType: string, targetId: string, role: string) => void;
  onStatusChange?: (assignmentId: string, status: string) => void;
  currentUserId?: string;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "待接受", className: "bg-zinc-100 text-zinc-600" },
  accepted: { label: "已接受", className: "bg-blue-100 text-blue-700" },
  in_progress: { label: "进行中", className: "bg-amber-100 text-amber-700" },
  completed: { label: "已完成", className: "bg-emerald-100 text-emerald-700" },
  declined: { label: "已拒绝", className: "bg-rose-100 text-rose-700" },
};

const ROLE_LABEL: Record<string, string> = {
  executor: "执行者",
  reviewer: "评审者",
  lead: "负责人",
};

const TARGET_TYPE_LABEL: Record<string, string> = {
  member: "成员",
  expert_team: "专家团",
  squad: "小队",
};

const TARGET_TYPE_OPTIONS = [
  { value: "member", label: "成员" },
  { value: "expert_team", label: "专家团" },
  { value: "squad", label: "小队" },
];

const ROLE_OPTIONS = [
  { value: "executor", label: "执行者" },
  { value: "reviewer", label: "评审者" },
  { value: "lead", label: "负责人" },
];

function TargetIcon({ type }: { type: string }) {
  if (type === "squad") return <Users className="h-4 w-4" />;
  if (type === "expert_team") return <Shield className="h-4 w-4" />;
  return <User className="h-4 w-4" />;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    className: "bg-zinc-100 text-zinc-600",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

export function AssignmentPanel({
  workItemId,
  assignments,
  onAssign,
  onStatusChange,
  currentUserId,
}: AssignmentPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [targetType, setTargetType] = useState("member");
  const [targetId, setTargetId] = useState("");
  const [role, setRole] = useState("executor");

  const handleSubmit = () => {
    if (!targetId.trim() || !onAssign) return;
    onAssign(targetType, targetId.trim(), role);
    setTargetId("");
    setShowForm(false);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          任务分配
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowForm((v) => !v)}
          className="h-7 gap-1 px-2 text-xs"
        >
          <UserPlus className="h-3.5 w-3.5" />
          分配
        </Button>
      </div>

      {assignments.length > 0 ? (
        <div className="space-y-2">
          {assignments.map((a) => {
            const isMine =
              !!currentUserId &&
              (a.target_id === currentUserId ||
                (a.dispatched_to?.includes(currentUserId) ?? false));
            return (
              <div
                key={a.id}
                className="rounded-lg border border-border/50 bg-card p-3 shadow-card"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <TargetIcon type={a.target_type} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {a.target_name || a.target_id}
                      </span>
                      <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {TARGET_TYPE_LABEL[a.target_type] ?? a.target_type}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {ROLE_LABEL[a.role] ?? a.role} · {formatTime(a.created_at)}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>

                {/* Squad 视角：已派遣成员 */}
                {a.target_type === "squad" &&
                  a.dispatched_to &&
                  a.dispatched_to.length > 0 && (
                    <div className="mt-2 rounded-md border border-border/40 bg-muted/20 p-2">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        已派遣成员 · {a.dispatched_to.length}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {a.dispatched_to.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[11px] text-foreground"
                          >
                            <User className="h-3 w-3" />
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                {a.notes && (
                  <div className="mt-2 rounded-md bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
                    {a.notes}
                  </div>
                )}

                {/* 当前用户操作按钮 */}
                {isMine && onStatusChange && (
                  <div className="mt-2 flex gap-2">
                    {a.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => onStatusChange(a.id, "accepted")}
                          className="h-7 px-3 text-xs"
                        >
                          接受任务
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onStatusChange(a.id, "declined")}
                          className="h-7 px-3 text-xs"
                        >
                          拒绝
                        </Button>
                      </>
                    )}
                    {(a.status === "accepted" || a.status === "in_progress") && (
                      <Button
                        size="sm"
                        onClick={() => onStatusChange(a.id, "completed")}
                        className="h-7 px-3 text-xs"
                      >
                        完成任务
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
          暂无分配
        </div>
      )}

      {/* 分配表单 */}
      {showForm && (
        <div className="mt-3 space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                目标类型
              </label>
              <Select
                options={TARGET_TYPE_OPTIONS}
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                角色
              </label>
              <Select
                options={ROLE_OPTIONS}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">
              目标 ID
            </label>
            <Input
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="成员/团队/小队 ID"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm(false)}
              className="h-7 px-3 text-xs"
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!targetId.trim()}
              className="h-7 px-3 text-xs"
            >
              确认分配
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
