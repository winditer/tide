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
  type GitCommitsParams,
  type GitChangesParams,
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
  return useQuery({
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
