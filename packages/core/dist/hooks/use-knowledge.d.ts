import { type KnowledgeGraphType, type KnowledgeScope } from "../api/knowledge";
/** 列出 .knowledge/ 下文件树 */
export declare function useKnowledgeFiles(scope: KnowledgeScope | undefined, targetId: string | undefined, projectId?: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").KnowledgeFilesResponse>, Error>;
/** 读取单个文件内容 */
export declare function useKnowledgeFile(scope: KnowledgeScope | undefined, targetId: string | undefined, path: string | undefined, projectId?: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").KnowledgeFileDetail>, Error>;
/** 保存 markdown 内容 */
export declare function useSaveKnowledgeFile(): import("@tanstack/react-query").UseMutationResult<import("..").KnowledgeFileDetail, Error, {
    scope: KnowledgeScope;
    targetId: string;
    path: string;
    content: string;
    projectId?: string;
}, unknown>;
/** 删除文件 */
export declare function useDeleteKnowledgeFile(): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
}, Error, {
    scope: KnowledgeScope;
    targetId: string;
    path: string;
    projectId?: string;
}, unknown>;
/** 触发异步生成 */
export declare function useTriggerKnowledgeGenerate(): import("@tanstack/react-query").UseMutationResult<import("..").KnowledgeJob, Error, {
    scope: KnowledgeScope;
    targetId: string;
    graphType?: KnowledgeGraphType;
}, unknown>;
/** 任务状态查询，运行中时自动轮询 */
export declare function useKnowledgeStatus(scope: KnowledgeScope | undefined, targetId: string | undefined, options?: {
    pollMs?: number;
}): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").KnowledgeJob>, Error>;
//# sourceMappingURL=use-knowledge.d.ts.map