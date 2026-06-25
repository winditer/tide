import { useMutation, useQuery, useQueryClient, } from "@tanstack/react-query";
import { deleteKnowledgeFile, getKnowledgeFile, getKnowledgeStatus, listKnowledgeFiles, saveKnowledgeFile, triggerKnowledgeGenerate, } from "../api/knowledge";
const KNOWLEDGE_KEY = "knowledge";
function listKey(scope, targetId, projectId) {
    return [KNOWLEDGE_KEY, "files", scope, targetId, projectId !== null && projectId !== void 0 ? projectId : null];
}
function fileKey(scope, targetId, path, projectId) {
    return [
        KNOWLEDGE_KEY,
        "file",
        scope,
        targetId,
        path,
        projectId !== null && projectId !== void 0 ? projectId : null,
    ];
}
function statusKey(scope, targetId) {
    return [KNOWLEDGE_KEY, "status", scope, targetId];
}
/** 列出 .knowledge/ 下文件树 */
export function useKnowledgeFiles(scope, targetId, projectId) {
    return useQuery({
        queryKey: listKey(scope !== null && scope !== void 0 ? scope : "project", targetId !== null && targetId !== void 0 ? targetId : "", projectId),
        queryFn: () => listKnowledgeFiles(scope, targetId, projectId),
        enabled: !!scope && !!targetId,
    });
}
/** 读取单个文件内容 */
export function useKnowledgeFile(scope, targetId, path, projectId) {
    return useQuery({
        queryKey: fileKey(scope !== null && scope !== void 0 ? scope : "project", targetId !== null && targetId !== void 0 ? targetId : "", path !== null && path !== void 0 ? path : "", projectId),
        queryFn: () => getKnowledgeFile(scope, targetId, path, projectId),
        enabled: !!scope && !!targetId && !!path,
    });
}
/** 保存 markdown 内容 */
export function useSaveKnowledgeFile() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input) => saveKnowledgeFile(input.scope, input.targetId, input.path, input.content, input.projectId),
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
        mutationFn: (input) => deleteKnowledgeFile(input.scope, input.targetId, input.path, input.projectId),
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
        mutationFn: (input) => {
            var _a;
            return triggerKnowledgeGenerate(input.scope, input.targetId, (_a = input.graphType) !== null && _a !== void 0 ? _a : "all");
        },
        onSuccess: (_data, vars) => {
            qc.invalidateQueries({ queryKey: statusKey(vars.scope, vars.targetId) });
        },
    });
}
/** 任务状态查询，运行中时自动轮询 */
export function useKnowledgeStatus(scope, targetId, options) {
    var _a;
    const pollMs = (_a = options === null || options === void 0 ? void 0 : options.pollMs) !== null && _a !== void 0 ? _a : 2000;
    return useQuery({
        queryKey: statusKey(scope !== null && scope !== void 0 ? scope : "project", targetId !== null && targetId !== void 0 ? targetId : ""),
        queryFn: () => getKnowledgeStatus(scope, targetId),
        enabled: !!scope && !!targetId,
        refetchInterval: (query) => {
            const data = query.state.data;
            if (!data)
                return false;
            return data.status === "pending" || data.status === "running"
                ? pollMs
                : false;
        },
    });
}
//# sourceMappingURL=use-knowledge.js.map