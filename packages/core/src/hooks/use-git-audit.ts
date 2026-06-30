import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGitCommits,
  getGitChanges,
  getGitBranches,
  getCommitDiff,
  getGitUncommitted,
  gitCommit,
  gitDiscard,
  gitIgnore,
  createBranch,
  deleteBranch,
  pushBranch,
  pullBranch,
  createMergeRequest,
  type GitCommitsParams,
  type GitChangesParams,
  type GitUncommittedResponse,
} from "../api/git-audit";

/**
 * 获取 Git 提交列表。
 */
export function useGitCommits(
  projectId: string | undefined,
  params?: GitCommitsParams,
) {
  return useQuery({
    queryKey: ["git-audit", "commits", projectId, params],
    queryFn: () => getGitCommits(projectId!, params),
    enabled: !!projectId,
  });
}

/**
 * 获取 Git 变更聚合。
 */
export function useGitChanges(
  projectId: string | undefined,
  params: GitChangesParams,
) {
  return useQuery({
    queryKey: ["git-audit", "changes", projectId, params],
    queryFn: () => getGitChanges(projectId!, params),
    enabled: !!projectId,
  });
}

/**
 * 获取 Git 分支列表。
 */
export function useGitBranches(projectId: string | undefined) {
  return useQuery({
    queryKey: ["git-audit", "branches", projectId],
    queryFn: () => getGitBranches(projectId!),
    enabled: !!projectId,
  });
}

/**
 * 获取单个 commit 的 diff。
 */
export function useCommitDiff(
  projectId: string | undefined,
  commitHash: string | null,
) {
  return useQuery({
    queryKey: ["git-audit", "diff", projectId, commitHash],
    queryFn: () => getCommitDiff(projectId!, commitHash!),
    enabled: !!projectId && !!commitHash,
  });
}

/**
 * 获取项目未提交的变更文件。
 */
export function useGitUncommitted(projectId: string | undefined) {
  return useQuery<GitUncommittedResponse>({
    queryKey: ["git-audit", "uncommitted", projectId],
    queryFn: () => getGitUncommitted(projectId!),
    enabled: !!projectId,
  });
}

/**
 * 提交文件 mutation。
 */
export function useGitCommitMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files, message }: { files: string[] | null; message: string }) =>
      gitCommit(projectId!, files, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git-audit", "uncommitted", projectId] });
      queryClient.invalidateQueries({ queryKey: ["git-audit", "commits", projectId] });
    },
  });
}

/**
 * 撤销文件修改 mutation。
 */
export function useGitDiscardMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files }: { files: string[] | null }) =>
      gitDiscard(projectId!, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git-audit", "uncommitted", projectId] });
    },
  });
}

/**
 * 将文件加入 .gitignore mutation。
 */
export function useGitIgnoreMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files }: { files: string[] }) =>
      gitIgnore(projectId!, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git-audit", "uncommitted", projectId] });
    },
  });
}

/**
 * 创建分支 mutation。
 */
export function useCreateBranch(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchName, startPoint }: { branchName: string; startPoint?: string }) =>
      createBranch(projectId!, branchName, startPoint),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git-audit", "branches", projectId] });
    },
  });
}

/**
 * 删除分支 mutation。
 */
export function useDeleteBranch(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (branchName: string) => deleteBranch(projectId!, branchName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git-audit", "branches", projectId] });
    },
  });
}

/**
 * 推送分支 mutation。
 */
export function usePushBranch(projectId: string | undefined) {
  return useMutation({
    mutationFn: ({ branchName, remote }: { branchName: string; remote?: string }) =>
      pushBranch(projectId!, branchName, remote),
  });
}

/**
 * 拉取分支 mutation。
 */
export function usePullBranch(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchName, remote }: { branchName?: string; remote?: string }) =>
      pullBranch(projectId!, branchName, remote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git-audit", "commits", projectId] });
    },
  });
}

/**
 * 创建合并请求 mutation。
 */
export function useCreateMergeRequest(projectId: string | undefined) {
  return useMutation({
    mutationFn: (params: { source_branch: string; target_branch: string; title: string; description?: string }) =>
      createMergeRequest(projectId!, params),
  });
}
