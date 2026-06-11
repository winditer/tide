"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  toast,
} from "@tide/ui";
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
  useProjects,
  useUserProjects,
  type AdminUser,
  type UserProjectAssignment,
} from "@tide/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, ShieldCheck, Trash2, X } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "admin", label: "管理员 (admin)" },
  { value: "member", label: "成员 (member)" },
  { value: "viewer", label: "只读 (viewer)" },
];

function getApiErrorMessage(err: unknown): string {
  if (!err) return "未知错误";
  const e = err as { body?: unknown; message?: string };
  if (e.body && typeof e.body === "object") {
    const detail = (e.body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return e.message ?? String(err);
}

export function ProjectAssignDialog({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const userProjectsQuery = useUserProjects(user?.id);
  const allProjectsQuery = useProjects();

  const [adding, setAdding] = useState(false);
  const [newProjectId, setNewProjectId] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  // Reset transient state when dialog opens/closes
  useEffect(() => {
    if (!user) {
      setAdding(false);
      setNewProjectId("");
      setNewRole("member");
      setBusyProjectId(null);
    }
  }, [user]);

  const isAdmin = !!userProjectsQuery.data?.is_admin;

  const assignedProjects = useMemo<UserProjectAssignment[]>(() => {
    const raw = userProjectsQuery.data?.projects;
    if (!raw || !Array.isArray(raw)) return [];
    return raw.filter(
      (p): p is UserProjectAssignment =>
        typeof p === "object" && p !== null && "project_id" in p,
    );
  }, [userProjectsQuery.data]);

  const projectById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    (allProjectsQuery.data?.projects ?? []).forEach((p) => map.set(p.id, p));
    return map;
  }, [allProjectsQuery.data]);

  const assignedSet = useMemo(
    () => new Set(assignedProjects.map((p) => p.project_id)),
    [assignedProjects],
  );

  const candidateProjects = useMemo(
    () =>
      (allProjectsQuery.data?.projects ?? []).filter(
        (p) => !assignedSet.has(p.id),
      ),
    [allProjectsQuery.data, assignedSet],
  );

  const invalidateUserProjects = () => {
    if (!user) return;
    qc.invalidateQueries({
      queryKey: ["admin", "users", "projects", user.id],
    });
  };

  const addMutation = useMutation({
    mutationFn: ({ projectId, role }: { projectId: string; role: string }) =>
      addProjectMember(projectId, { user_id: user!.id, role }),
    onSuccess: () => invalidateUserProjects(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ projectId, role }: { projectId: string; role: string }) =>
      updateProjectMemberRole(projectId, user!.id, { role }),
    onSuccess: () => invalidateUserProjects(),
  });

  const removeMutation = useMutation({
    mutationFn: ({ projectId }: { projectId: string }) =>
      removeProjectMember(projectId, user!.id),
    onSuccess: () => invalidateUserProjects(),
  });

  const startAdd = () => {
    setAdding(true);
    setNewProjectId(candidateProjects[0]?.id ?? "");
    setNewRole("member");
  };

  const submitAdd = async () => {
    if (!user || !newProjectId) {
      toast({ title: "请选择项目", variant: "destructive" });
      return;
    }
    try {
      await addMutation.mutateAsync({ projectId: newProjectId, role: newRole });
      toast({
        title: "已添加项目",
        description: projectById.get(newProjectId)?.name ?? newProjectId,
      });
      setAdding(false);
      setNewProjectId("");
      setNewRole("member");
    } catch (err) {
      toast({
        title: "添加失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const onChangeRole = async (projectId: string, role: string) => {
    if (!user) return;
    setBusyProjectId(projectId);
    try {
      await updateMutation.mutateAsync({ projectId, role });
      toast({
        title: "已更新角色",
        description: projectById.get(projectId)?.name ?? projectId,
      });
    } catch (err) {
      toast({
        title: "更新失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setBusyProjectId(null);
    }
  };

  const onRemove = async (projectId: string) => {
    if (!user) return;
    setBusyProjectId(projectId);
    try {
      await removeMutation.mutateAsync({ projectId });
      toast({
        title: "已移除项目",
        description: projectById.get(projectId)?.name ?? projectId,
      });
    } catch (err) {
      toast({
        title: "移除失败",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setBusyProjectId(null);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background/95 backdrop-blur-xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-indigo-500" />
            管理项目{user ? ` - ${user.username}` : ""}
          </DialogTitle>
          <DialogDescription>
            为用户分配项目访问权限。修改后立即生效。
          </DialogDescription>
        </DialogHeader>

        {user && (
          <div className="space-y-4">
            {isAdmin ? (
              <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 px-4 py-3.5 shadow-card">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="text-sm font-medium">系统管理员</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  该用户拥有 admin 全局角色，可访问所有项目，无需逐个分配。
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-hidden rounded-xl border border-border/50 bg-card shadow-card">
                  {userProjectsQuery.isLoading ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      加载中…
                    </div>
                  ) : userProjectsQuery.isError ? (
                    <div className="px-4 py-10 text-center text-sm text-destructive">
                      加载失败：{getApiErrorMessage(userProjectsQuery.error)}
                    </div>
                  ) : assignedProjects.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      尚未分配任何项目
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">项目</th>
                          <th className="w-44 px-4 py-2.5 font-medium">角色</th>
                          <th className="w-20 px-4 py-2.5 text-right font-medium">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {assignedProjects.map((p) => {
                          const info = projectById.get(p.project_id);
                          const busy = busyProjectId === p.project_id;
                          return (
                            <tr
                              key={p.project_id}
                              className="transition-smooth hover:bg-muted/30"
                            >
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 text-indigo-500">
                                    <FolderKanban className="h-3.5 w-3.5" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">
                                      {info?.name ?? p.project_id}
                                    </div>
                                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                                      {p.project_id}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                <Select
                                  value={p.role}
                                  onChange={(e) =>
                                    onChangeRole(p.project_id, e.target.value)
                                  }
                                  options={ROLE_OPTIONS}
                                  disabled={busy}
                                  className="h-8 rounded-md border-border/50 text-xs"
                                />
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => onRemove(p.project_id)}
                                  disabled={busy}
                                  title="移除"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {adding ? (
                  <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 shadow-card">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto_auto] sm:items-end">
                      <label className="block min-w-0">
                        <span className="mb-1 block text-xs font-medium text-foreground">
                          项目
                        </span>
                        <Select
                          value={newProjectId}
                          onChange={(e) => setNewProjectId(e.target.value)}
                          options={
                            candidateProjects.length === 0
                              ? [{ value: "", label: "（暂无可添加项目）" }]
                              : candidateProjects.map((p) => ({
                                  value: p.id,
                                  label: `${p.name} · ${p.id}`,
                                }))
                          }
                          disabled={
                            candidateProjects.length === 0 ||
                            addMutation.isPending
                          }
                          className="h-9 rounded-md border-border/50 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-foreground">
                          角色
                        </span>
                        <Select
                          value={newRole}
                          onChange={(e) => setNewRole(e.target.value)}
                          options={ROLE_OPTIONS}
                          disabled={addMutation.isPending}
                          className="h-9 rounded-md border-border/50 text-sm"
                        />
                      </label>
                      <Button
                        size="sm"
                        onClick={submitAdd}
                        disabled={addMutation.isPending || !newProjectId}
                      >
                        {addMutation.isPending ? "添加中…" : "确认"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAdding(false)}
                        disabled={addMutation.isPending}
                        title="取消"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {candidateProjects.length === 0 && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        所有项目都已分配给该用户。
                      </p>
                    )}
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    onClick={startAdd}
                    disabled={allProjectsQuery.isLoading}
                    className="w-full gap-1.5 border-dashed border-border/70 text-muted-foreground hover:border-indigo-500/50 hover:text-foreground"
                  >
                    <Plus className="h-4 w-4" /> 添加项目
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
