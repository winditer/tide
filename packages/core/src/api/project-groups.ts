import { apiClient } from "./client";

/**
 * 项目组成员（关联到具体项目仓库）。
 * - ``project_id`` 为 base64 编码的项目绝对路径；
 * - ``cwd`` / ``name`` 由后端从 ``project_id`` 还原；
 * - ``role`` 中 "primary" 项目用于跨仓库工作项的执行根目录。
 */
export interface ProjectGroupMember {
  id: string;
  group_id: string;
  project_id: string;
  role: "primary" | "member" | string;
  display_order: number;
  added_at: string | null;
  /** 由后端从 project_id 还原，可能为 null（路径已不存在）。 */
  cwd: string | null;
  /** 由后端从 cwd 推导的目录名。 */
  name: string;
}

/** 项目组列表项（包含成员数量，但不展开 members）。 */
export interface ProjectGroupSummary {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  member_count: number;
}

/** 项目组详情（含 members 列表）。 */
export interface ProjectGroupDetail extends ProjectGroupSummary {
  members: ProjectGroupMember[];
  /** 用户成员数（来自 project_group_user_members）。 */
  user_member_count?: number;
}

export interface ListProjectGroupsResponse {
  groups: ProjectGroupSummary[];
}

export interface CreateProjectGroupInput {
  name: string;
  description?: string;
  workspace_id?: string;
  created_by?: string;
  /**
   * 初始成员项目 id 列表。第一个会被标记为 ``primary``，
   * 后续以 ``member`` 加入。
   */
  project_ids?: string[];
}

export interface UpdateProjectGroupInput {
  name?: string;
  description?: string;
}

export interface AddGroupMemberInput {
  project_id: string;
  role?: "primary" | "member" | string;
}

/** 可添加为项目组用户成员的候选用户。 */
export interface GroupAvailableUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: string;
}

export interface ListGroupAvailableUsersResponse {
  items: GroupAvailableUser[];
  total: number;
}

/** 按 session_id 聚合的会话条目（来自 tasks 表）。 */
export interface GroupConversationItem {
  session_id: string;
  agent_id: string | null;
  cwd: string | null;
  task_count: number;
  last_status: string | null;
  last_active: string | null;
  created_at: string | null;
}

/** 项目组任务列表条目（来自 tasks 表）。 */
export interface GroupTaskItem {
  id: string;
  workspace_id: string | null;
  prompt: string | null;
  cwd: string | null;
  agent_id: string | null;
  session_id: string | null;
  status: string;
  priority?: string | null;
  labels?: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms?: number | null;
  result?: string | null;
  diff_summary?: string | null;
  branch_name?: string | null;
  worktree_path?: string | null;
  output_path?: string | null;
}

/** 项目组版本列表条目。 */
export interface GroupVersionItem {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface GroupWorkflowBinding {
  group_id: string;
  workflow_id: string | null;
  workflow_name: string | null;
  flow_mode?: string | null;
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function listProjectGroups(
  workspaceId?: string,
): Promise<ListProjectGroupsResponse> {
  const qs = buildQuery({ workspace_id: workspaceId });
  return apiClient.get<ListProjectGroupsResponse>(`/api/project-groups${qs}`);
}

export function getProjectGroup(groupId: string): Promise<ProjectGroupDetail> {
  return apiClient.get<ProjectGroupDetail>(
    `/api/project-groups/${encodeURIComponent(groupId)}`,
  );
}

export function createProjectGroup(
  body: CreateProjectGroupInput,
): Promise<ProjectGroupDetail> {
  return apiClient.post<ProjectGroupDetail>("/api/project-groups", body);
}

export function updateProjectGroup(
  groupId: string,
  body: UpdateProjectGroupInput,
): Promise<ProjectGroupDetail> {
  return apiClient.put<ProjectGroupDetail>(
    `/api/project-groups/${encodeURIComponent(groupId)}`,
    body,
  );
}

export function deleteProjectGroup(
  groupId: string,
): Promise<{ ok: boolean }> {
  return apiClient.del<{ ok: boolean }>(
    `/api/project-groups/${encodeURIComponent(groupId)}`,
  );
}

export function addGroupMember(
  groupId: string,
  body: AddGroupMemberInput,
): Promise<ProjectGroupMember> {
  return apiClient.post<ProjectGroupMember>(
    `/api/project-groups/${encodeURIComponent(groupId)}/members`,
    body,
  );
}

export function removeGroupMember(
  groupId: string,
  projectId: string,
): Promise<{ ok: boolean }> {
  return apiClient.del<{ ok: boolean }>(
    `/api/project-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(
      projectId,
    )}`,
  );
}

/**
 * 列出可添加为项目组用户成员的候选用户（排除已是该组成员者）。
 * 权限：项目组 owner 或全局 admin。
 */
export function listGroupAvailableUsers(
  groupId: string,
  params?: { q?: string; page?: number; page_size?: number },
): Promise<ListGroupAvailableUsersResponse> {
  const qs = buildQuery({
    q: params?.q,
    page: params?.page,
    page_size: params?.page_size,
  });
  return apiClient.get<ListGroupAvailableUsersResponse>(
    `/api/project-groups/${encodeURIComponent(groupId)}/users/available${qs}`,
  );
}

// ── 聚合查询 ───────────────────────────────────────────────────────────────

/** 拉取项目组聚合的会话列表（按 session_id 去重，按最后活跃时间倒序）。 */
export function getGroupConversations(
  groupId: string,
  params?: { limit?: number; offset?: number },
): Promise<PaginatedResponse<GroupConversationItem>> {
  const qs = buildQuery({
    limit: params?.limit,
    offset: params?.offset,
  });
  return apiClient.get<PaginatedResponse<GroupConversationItem>>(
    `/api/project-groups/${encodeURIComponent(groupId)}/conversations${qs}`,
  );
}

/** 拉取项目组聚合的任务列表。 */
export function getGroupTasks(
  groupId: string,
  params?: { status?: string; limit?: number; offset?: number },
): Promise<PaginatedResponse<GroupTaskItem>> {
  const qs = buildQuery({
    status: params?.status,
    limit: params?.limit,
    offset: params?.offset,
  });
  return apiClient.get<PaginatedResponse<GroupTaskItem>>(
    `/api/project-groups/${encodeURIComponent(groupId)}/tasks${qs}`,
  );
}

/** 拉取项目组聚合的版本列表（跨成员项目）。 */
export function getGroupVersions(
  groupId: string,
  params?: { limit?: number; offset?: number },
): Promise<PaginatedResponse<GroupVersionItem>> {
  const qs = buildQuery({
    limit: params?.limit,
    offset: params?.offset,
  });
  return apiClient.get<PaginatedResponse<GroupVersionItem>>(
    `/api/project-groups/${encodeURIComponent(groupId)}/versions${qs}`,
  );
}

// ── 項目组 Git 聚合 ──────────────────────────────────────────

export interface GroupBranchProject {
  project_id: string;
  name: string;
  cwd: string;
  branches: string[];
  current: string | null;
}

export interface GroupCommitItem {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: { path: string; status: string; additions: number; deletions: number }[];
  project_id: string;
  project_name: string;
}

export interface GroupChangeProject {
  project_id: string;
  name: string;
  changes: {
    id: string;
    name: string;
    branch: string | null;
    commit_count: number;
    files_changed: number;
    additions: number;
    deletions: number;
  }[];
}

export function getGroupBranches(
  groupId: string,
): Promise<{ items: GroupBranchProject[] }> {
  return apiClient.get<{ items: GroupBranchProject[] }>(
    `/api/project-groups/${encodeURIComponent(groupId)}/git/branches`,
  );
}

export interface GroupBranchCreateResult {
  project_id: string;
  name: string;
  ok: boolean;
  branch?: string;
  error?: string;
}

export interface GroupVersionCreateResult {
  project_id: string;
  name: string;
  ok: boolean;
  version_id?: string;
  error?: string;
}

/**
 * 为项目组内子项目创建分支。
 */
export function createGroupBranch(
  groupId: string,
  branchName: string,
  startPoint?: string,
  projectIds?: string[],
): Promise<{ ok: boolean; results: GroupBranchCreateResult[] }> {
  return apiClient.post<{ ok: boolean; results: GroupBranchCreateResult[] }>(
    `/api/project-groups/${encodeURIComponent(groupId)}/git/branches`,
    { branch_name: branchName, start_point: startPoint, project_ids: projectIds },
  );
}

export function getGroupCommits(
  groupId: string,
  params?: { since?: string; until?: string; limit?: number },
): Promise<{ commits: GroupCommitItem[]; total: number }> {
  const qs = buildQuery(params as Record<string, string | number | undefined>);
  return apiClient.get<{ commits: GroupCommitItem[]; total: number }>(
    `/api/project-groups/${encodeURIComponent(groupId)}/git/commits${qs}`,
  );
}

export function getGroupChanges(
  groupId: string,
  params?: { group_by?: string; since?: string; until?: string },
): Promise<{ projects: GroupChangeProject[]; group_by: string }> {
  const qs = buildQuery(params as Record<string, string | number | undefined>);
  return apiClient.get<{ projects: GroupChangeProject[]; group_by: string }>(
    `/api/project-groups/${encodeURIComponent(groupId)}/git/changes${qs}`,
  );
}

export function getGroupCommitDiff(
  groupId: string,
  projectId: string,
  commitHash: string,
): Promise<string> {
  return apiClient.get<string>(
    `/api/project-groups/${encodeURIComponent(groupId)}/git/diff/${encodeURIComponent(projectId)}/${encodeURIComponent(commitHash)}`,
  );
}

/**
 * 为项目组内子项目创建同名版本。
 */
export function createGroupVersion(
  groupId: string,
  name: string,
  description?: string,
  projectIds?: string[],
): Promise<{ ok: boolean; results: GroupVersionCreateResult[] }> {
  return apiClient.post<{ ok: boolean; results: GroupVersionCreateResult[] }>(
    `/api/project-groups/${encodeURIComponent(groupId)}/versions`,
    { name, description, project_ids: projectIds },
  );
}

// ── 工作流绑定 ────────────────────────────────────────────────────────────

export function getGroupWorkflow(
  groupId: string,
): Promise<GroupWorkflowBinding> {
  return apiClient.get<GroupWorkflowBinding>(
    `/api/project-groups/${encodeURIComponent(groupId)}/workflow`,
  );
}

export function setGroupWorkflow(
  groupId: string,
  workflowId?: string | null,
  flowMode?: string,
): Promise<GroupWorkflowBinding> {
  return apiClient.put<GroupWorkflowBinding>(
    `/api/project-groups/${encodeURIComponent(groupId)}/workflow`,
    { workflow_id: workflowId ?? undefined, flow_mode: flowMode },
  );
}

export function deleteGroupWorkflow(
  groupId: string,
): Promise<{ ok: boolean; group_id: string; workflow_id: null }> {
  return apiClient.del<{ ok: boolean; group_id: string; workflow_id: null }>(
    `/api/project-groups/${encodeURIComponent(groupId)}/workflow`,
  );
}
