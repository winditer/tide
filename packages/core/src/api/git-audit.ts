import { apiClient } from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitCommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitUncommittedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "untracked" | "renamed";
  staged: boolean;
}

export interface GitUncommittedResponse {
  files: GitUncommittedFile[];
  total: number;
  current_branch: string | null;
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: GitCommitFile[];
}

export interface GitChangeGroup {
  name: string;
  id?: string;
  branch: string;
  branches?: string[];
  commit_count: number;
  files_changed: number;
  additions: number;
  deletions: number;
  task_count?: number;
  last_active?: string;
  created_at?: string;
}

export interface GitCommitsParams {
  branch?: string;
  since?: string;
  until?: string;
  limit?: number;
  work_item_id?: string;
  version_id?: string;
  all_branches?: boolean;
}

export interface GitChangesParams {
  group_by: "work_item" | "session" | "branch" | "version";
  since?: string;
  until?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildQuery(params?: Record<string, string | number | undefined | null>): string {
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

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * 获取项目的 Git 提交列表。
 */
export async function getGitCommits(
  projectId: string,
  params?: GitCommitsParams,
): Promise<GitCommit[]> {
  const qs = buildQuery({
    branch: params?.branch,
    since: params?.since,
    until: params?.until,
    limit: params?.limit,
    work_item_id: params?.work_item_id,
    version_id: params?.version_id,
    all_branches: params?.all_branches ? "true" : undefined,
  });
  const res = await apiClient.get<{ commits: GitCommit[]; total: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/commits${qs}`,
  );
  return res.commits ?? [];
}

/**
 * 获取项目的 Git 变更聚合信息。
 */
export async function getGitChanges(
  projectId: string,
  params: GitChangesParams,
): Promise<GitChangeGroup[]> {
  const qs = buildQuery({
    group_by: params.group_by,
    since: params.since,
    until: params.until,
  });
  const res = await apiClient.get<{ changes: GitChangeGroup[]; group_by: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/changes${qs}`,
  );
  return res.changes ?? [];
}

/**
 * 获取项目的 Git 分支列表。
 */
export async function getGitBranches(
  projectId: string,
): Promise<{ branches: string[]; current: string | null }> {
  return apiClient.get<{ branches: string[]; current: string | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/branches`,
  );
}

/**
 * 获取项目未提交的变更文件列表。
 */
export async function getGitUncommitted(
  projectId: string,
): Promise<GitUncommittedResponse> {
  const res = await apiClient.get<GitUncommittedResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/git/uncommitted`,
  );
  return {
    files: res.files ?? [],
    total: res.total ?? 0,
    current_branch: res.current_branch ?? null,
  };
}

/**
 * 获取单个 commit 的 diff 内容。
 */
export function getCommitDiff(
  projectId: string,
  commitHash: string,
): Promise<string> {
  return apiClient.get<string>(
    `/api/projects/${encodeURIComponent(projectId)}/git/diff/${encodeURIComponent(commitHash)}`,
  );
}

/**
 * 提交文件。
 */
export function gitCommit(
  projectId: string,
  files: string[] | null,
  message: string,
): Promise<{ ok: boolean; message: string }> {
  return apiClient.post<{ ok: boolean; message: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/commit`,
    { files, message },
  );
}

/**
 * 撤销文件修改。
 */
export function gitDiscard(
  projectId: string,
  files: string[] | null,
): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/discard`,
    { files },
  );
}

/**
 * 将文件加入 .gitignore。
 */
export function gitIgnore(
  projectId: string,
  files: string[],
): Promise<{ ok: boolean; added: string[] }> {
  return apiClient.post<{ ok: boolean; added: string[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/ignore`,
    { files },
  );
}

/**
 * 创建分支。
 */
export function createBranch(
  projectId: string,
  branchName: string,
  startPoint?: string,
): Promise<{ ok: boolean; branch: string }> {
  return apiClient.post<{ ok: boolean; branch: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/branches`,
    { branch_name: branchName, start_point: startPoint },
  );
}

/**
 * 删除分支。
 */
export function deleteBranch(
  projectId: string,
  branchName: string,
): Promise<{ ok: boolean }> {
  return apiClient.del<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/branches/${encodeURIComponent(branchName)}`,
  );
}

/**
 * 推送分支到远端。
 */
export function pushBranch(
  projectId: string,
  branchName: string,
  remote?: string,
): Promise<{ ok: boolean; output: string }> {
  return apiClient.post<{ ok: boolean; output: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/push`,
    { branch_name: branchName, remote },
  );
}

/**
 * 从远端拉取分支。
 */
export function pullBranch(
  projectId: string,
  branchName?: string,
  remote?: string,
): Promise<{ ok: boolean; output: string }> {
  return apiClient.post<{ ok: boolean; output: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/pull`,
    { branch_name: branchName, remote },
  );
}

/**
 * 创建合并请求。
 */
export function createMergeRequest(
  projectId: string,
  params: {
    source_branch: string;
    target_branch: string;
    title: string;
    description?: string;
  },
): Promise<{ ok: boolean; url: string }> {
  return apiClient.post<{ ok: boolean; url: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/merge-request`,
    params,
  );
}
