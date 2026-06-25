import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  listDirectory,
  getFileContent,
  saveFileContent,
  getFileDiff,
  getConflictDetail,
  resolveFileConflict,
  aiResolveConflict,
  type AIResolveConflictParams,
} from "../api/files";

/**
 * 文件目录树 hook（懒加载子目录）。
 */
export function useFileTree(
  projectId: string | undefined,
  path: string,
  depth?: number,
) {
  return useQuery({
    queryKey: ["files", "tree", projectId, path, depth ?? 1],
    queryFn: () => listDirectory(projectId!, path, depth),
    enabled: !!projectId && !!path,
  });
}

/**
 * 文件内容 hook。
 */
export function useFileContent(
  projectId: string | undefined,
  filePath: string | null,
) {
  return useQuery({
    queryKey: ["files", "content", projectId, filePath],
    queryFn: () => getFileContent(projectId!, filePath!),
    enabled: !!projectId && !!filePath,
  });
}

/**
 * 保存文件 mutation。
 */
export function useSaveFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      path,
      content,
    }: {
      projectId: string;
      path: string;
      content: string;
    }) => saveFileContent(projectId, path, content),
    onSuccess: (_data, { projectId, path }) => {
      queryClient.invalidateQueries({
        queryKey: ["files", "content", projectId, path],
      });
    },
  });
}

/**
 * Git diff hook。
 */
export function useFileDiff(
  projectId: string | undefined,
  ref1?: string,
  ref2?: string,
  path?: string,
) {
  return useQuery({
    queryKey: ["files", "diff", projectId, ref1, ref2, path],
    queryFn: () => getFileDiff(projectId!, ref1, ref2, path),
    enabled: !!projectId,
  });
}

/**
 * 冲突详情 hook。
 */
export function useConflictDetail(
  projectId: string | undefined,
  cwd: string,
  filePath: string | null,
) {
  return useQuery({
    queryKey: ["files", "conflict", projectId, cwd, filePath],
    queryFn: () => getConflictDetail(projectId!, cwd, filePath!),
    enabled: !!projectId && !!cwd && !!filePath,
  });
}

/**
 * 解决冲突 mutation。
 */
export function useResolveConflict() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      cwd,
      filePath,
      resolvedContent,
    }: {
      projectId: string;
      cwd: string;
      filePath: string;
      resolvedContent: string;
    }) => resolveFileConflict(projectId, cwd, filePath, resolvedContent),
    onSuccess: (_data, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["files", "conflict", projectId] });
    },
  });
}

/**
 * AI 解决冲突 mutation。
 */
export function useAIResolveConflict() {
  return useMutation({
    mutationFn: (params: AIResolveConflictParams) => aiResolveConflict(params),
  });
}
