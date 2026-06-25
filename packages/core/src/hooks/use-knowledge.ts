import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteKnowledgeFile,
  getKnowledgeFile,
  getKnowledgeStatus,
  listKnowledgeFiles,
  saveKnowledgeFile,
  triggerKnowledgeGenerate,
  type KnowledgeGraphType,
  type KnowledgeScope,
} from "../api/knowledge";

const KNOWLEDGE_KEY = "knowledge" as const;

function listKey(scope: KnowledgeScope, targetId: string, projectId?: string) {
  return [KNOWLEDGE_KEY, "files", scope, targetId, projectId ?? null] as const;
}

function fileKey(
  scope: KnowledgeScope,
  targetId: string,
  path: string,
  projectId?: string,
) {
  return [
    KNOWLEDGE_KEY,
    "file",
    scope,
    targetId,
    path,
    projectId ?? null,
  ] as const;
}

function statusKey(scope: KnowledgeScope, targetId: string) {
  return [KNOWLEDGE_KEY, "status", scope, targetId] as const;
}

/** 列出 .knowledge/ 下文件树 */
export function useKnowledgeFiles(
  scope: KnowledgeScope | undefined,
  targetId: string | undefined,
  projectId?: string,
) {
  return useQuery({
    queryKey: listKey(scope ?? "project", targetId ?? "", projectId),
    queryFn: () => listKnowledgeFiles(scope!, targetId!, projectId),
    enabled: !!scope && !!targetId,
  });
}

/** 读取单个文件内容 */
export function useKnowledgeFile(
  scope: KnowledgeScope | undefined,
  targetId: string | undefined,
  path: string | undefined,
  projectId?: string,
) {
  return useQuery({
    queryKey: fileKey(scope ?? "project", targetId ?? "", path ?? "", projectId),
    queryFn: () => getKnowledgeFile(scope!, targetId!, path!, projectId),
    enabled: !!scope && !!targetId && !!path,
  });
}

/** 保存 markdown 内容 */
export function useSaveKnowledgeFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: KnowledgeScope;
      targetId: string;
      path: string;
      content: string;
      projectId?: string;
    }) =>
      saveKnowledgeFile(
        input.scope,
        input.targetId,
        input.path,
        input.content,
        input.projectId,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: listKey(vars.scope, vars.targetId, vars.projectId),
      });
      qc.invalidateQueries({
        queryKey: fileKey(vars.scope, vars.targetId, vars.path, vars.projectId),
      });
    },
  });
}

/** 删除文件 */
export function useDeleteKnowledgeFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: KnowledgeScope;
      targetId: string;
      path: string;
      projectId?: string;
    }) =>
      deleteKnowledgeFile(
        input.scope,
        input.targetId,
        input.path,
        input.projectId,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: listKey(vars.scope, vars.targetId, vars.projectId),
      });
    },
  });
}

/** 触发异步生成 */
export function useTriggerKnowledgeGenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: KnowledgeScope;
      targetId: string;
      graphType?: KnowledgeGraphType;
      agentId?: string;
    }) =>
      triggerKnowledgeGenerate(
        input.scope,
        input.targetId,
        input.graphType ?? "all",
        input.agentId,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: statusKey(vars.scope, vars.targetId) });
    },
  });
}

/** 任务状态查询，运行中时自动轮询 */
export function useKnowledgeStatus(
  scope: KnowledgeScope | undefined,
  targetId: string | undefined,
  options?: { pollMs?: number },
) {
  const pollMs = options?.pollMs ?? 2000;
  return useQuery({
    queryKey: statusKey(scope ?? "project", targetId ?? ""),
    queryFn: () => getKnowledgeStatus(scope!, targetId!),
    enabled: !!scope && !!targetId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return data.status === "pending" || data.status === "running"
        ? pollMs
        : false;
    },
  });
}
