import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addGroupMember,
  createProjectGroup,
  deleteGroupWorkflow,
  deleteProjectGroup,
  getGroupBranches,
  getGroupChanges,
  getGroupCommits,
  getGroupConversations,
  getGroupTasks,
  getGroupVersions,
  getGroupWorkflow,
  getProjectGroup,
  listProjectGroups,
  listGroupAvailableUsers,
  removeGroupMember,
  setGroupWorkflow,
  updateProjectGroup,
  type AddGroupMemberInput,
  type CreateProjectGroupInput,
  type UpdateProjectGroupInput,
} from "../api/project-groups";

const groupsKey = (workspaceId?: string) =>
  ["project-groups", workspaceId ?? "default"] as const;
const groupKey = (groupId: string) => ["project-group", groupId] as const;
const groupConversationsKey = (
  groupId: string,
  params?: { limit?: number; offset?: number },
) =>
  [
    "project-group",
    groupId,
    "conversations",
    params?.limit ?? null,
    params?.offset ?? null,
  ] as const;
const groupTasksKey = (
  groupId: string,
  params?: { status?: string; limit?: number; offset?: number },
) =>
  [
    "project-group",
    groupId,
    "tasks",
    params?.status ?? null,
    params?.limit ?? null,
    params?.offset ?? null,
  ] as const;
const groupVersionsKey = (
  groupId: string,
  params?: { limit?: number; offset?: number },
) =>
  [
    "project-group",
    groupId,
    "versions",
    params?.limit ?? null,
    params?.offset ?? null,
  ] as const;
const groupWorkflowKey = (groupId: string) =>
  ["project-group", groupId, "workflow"] as const;

/**
 * 拉取当前 workspace 下的所有项目组（不展开 members）。
 *
 * @example
 *   const { data } = useProjectGroups();
 *   const groups = data?.groups ?? [];
 */
export function useProjectGroups(workspaceId?: string) {
  return useQuery({
    queryKey: groupsKey(workspaceId),
    queryFn: () => listProjectGroups(workspaceId),
  });
}

/** 拉取单个项目组详情（含 members 列表）。 */
export function useProjectGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: groupKey(groupId ?? ""),
    queryFn: () => getProjectGroup(groupId as string),
    enabled: !!groupId,
  });
}

export function useCreateProjectGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectGroupInput) => createProjectGroup(body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: groupsKey(vars.workspace_id) });
    },
  });
}

export function useUpdateProjectGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      body,
    }: {
      groupId: string;
      body: UpdateProjectGroupInput;
    }) => updateProjectGroup(groupId, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["project-groups"] });
      qc.invalidateQueries({ queryKey: groupKey(vars.groupId) });
    },
  });
}

export function useDeleteProjectGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => deleteProjectGroup(groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-groups"] });
    },
  });
}

export function useAddGroupMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddGroupMemberInput) => addGroupMember(groupId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-groups"] });
      qc.invalidateQueries({ queryKey: groupKey(groupId) });
    },
  });
}

export function useRemoveGroupMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => removeGroupMember(groupId, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-groups"] });
      qc.invalidateQueries({ queryKey: groupKey(groupId) });
    },
  });
}

/** 拉取可添加为项目组用户成员的候选用户列表。 */
export function useGroupAvailableUsers(
  groupId: string | undefined,
  params?: { q?: string; page?: number; page_size?: number },
) {
  return useQuery({
    queryKey: ["project-group-users-available", groupId ?? "", params ?? null],
    queryFn: () => listGroupAvailableUsers(groupId as string, params),
    enabled: !!groupId,
  });
}

// ── 聚合查询 hooks ──────────────────────────────────────────────────────────

export function useGroupConversations(
  groupId: string | undefined,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: groupConversationsKey(groupId ?? "", params),
    queryFn: () => getGroupConversations(groupId as string, params),
    enabled: !!groupId,
  });
}

export function useGroupTasks(
  groupId: string | undefined,
  params?: { status?: string; limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: groupTasksKey(groupId ?? "", params),
    queryFn: () => getGroupTasks(groupId as string, params),
    enabled: !!groupId,
  });
}

export function useGroupVersions(
  groupId: string | undefined,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: groupVersionsKey(groupId ?? "", params),
    queryFn: () => getGroupVersions(groupId as string, params),
    enabled: !!groupId,
  });
}

export function useGroupWorkflow(groupId: string | undefined) {
  return useQuery({
    queryKey: groupWorkflowKey(groupId ?? ""),
    queryFn: () => getGroupWorkflow(groupId as string),
    enabled: !!groupId,
  });
}

export function useSetGroupWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      workflowId,
      flowMode,
    }: {
      groupId: string;
      workflowId?: string | null;
      flowMode?: string;
    }) => setGroupWorkflow(groupId, workflowId, flowMode),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: groupWorkflowKey(vars.groupId) });
    },
  });
}

export function useDeleteGroupWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => deleteGroupWorkflow(groupId),
    onSuccess: (_, groupId) => {
      qc.invalidateQueries({ queryKey: groupWorkflowKey(groupId) });
    },
  });
}

// ── 项目组 Git 聚合 hooks ─────────────────────────────────────

const groupBranchesKey = (groupId: string) =>
  ["project-group", groupId, "branches"] as const;
const groupCommitsKey = (
  groupId: string,
  params?: { since?: string; until?: string; limit?: number },
) =>
  ["project-group", groupId, "commits", params ?? null] as const;
const groupChangesKey = (
  groupId: string,
  params?: { group_by?: string; since?: string; until?: string },
) =>
  ["project-group", groupId, "changes", params ?? null] as const;

export function useGroupBranches(groupId: string | undefined) {
  return useQuery({
    queryKey: groupBranchesKey(groupId ?? ""),
    queryFn: () => getGroupBranches(groupId as string),
    enabled: !!groupId,
  });
}

export function useGroupCommits(
  groupId: string | undefined,
  params?: { since?: string; until?: string; limit?: number },
) {
  return useQuery({
    queryKey: groupCommitsKey(groupId ?? "", params),
    queryFn: () => getGroupCommits(groupId as string, params),
    enabled: !!groupId,
  });
}

export function useGroupChanges(
  groupId: string | undefined,
  params?: { group_by?: string; since?: string; until?: string },
) {
  return useQuery({
    queryKey: groupChangesKey(groupId ?? "", params),
    queryFn: () => getGroupChanges(groupId as string, params),
    enabled: !!groupId,
  });
}
