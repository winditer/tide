/** 知识图谱所属范围：单个项目 / 项目组 */
export type KnowledgeScope = "project" | "group";
/** 图谱类型：全部 / 模块依赖 / API / 数据库 / 业务概念 */
export type KnowledgeGraphType = "all" | "module" | "api" | "db" | "concept";
/** 任务状态：空闲 / 待启动 / 运行中 / 完成 / 失败 */
export type KnowledgeJobStatus = "idle" | "pending" | "running" | "completed" | "failed";
export interface KnowledgeFileEntry {
    /** 相对 .knowledge/ 的路径，例如 "module/index.md" */
    path: string;
    name: string;
    ext: string;
    size: number;
    modified_at?: string | null;
}
export interface KnowledgeMeta {
    schema_version?: string;
    version?: number;
    repo_name?: string;
    git_commit?: string;
    git_branch?: string;
    generated_at?: string;
    generator?: string;
    sections?: string[];
}
export interface KnowledgeRepoFiles {
    project_id: string;
    name: string;
    cwd: string;
    files: KnowledgeFileEntry[];
    meta?: KnowledgeMeta | null;
}
export interface KnowledgeFilesResponse {
    scope: KnowledgeScope;
    target_id: string;
    repos: KnowledgeRepoFiles[];
}
export interface KnowledgeFileDetail extends KnowledgeFileEntry {
    content: string;
    project_id?: string;
}
export interface KnowledgeJobRepo {
    project_id: string;
    cwd: string;
    name: string;
}
export interface KnowledgeJobLog {
    repo: string;
    cwd: string;
    returncode: number;
    stdout_tail?: string;
    stderr_tail?: string;
}
export interface KnowledgeJob {
    job_id?: string;
    scope: KnowledgeScope;
    target_id: string;
    graph_type?: KnowledgeGraphType;
    status: KnowledgeJobStatus;
    started_at?: string | null;
    finished_at?: string | null;
    error?: string | null;
    repos?: KnowledgeJobRepo[];
    progress?: {
        total: number;
        done: number;
        current?: string | null;
    };
    logs?: KnowledgeJobLog[];
}
/** 列出 .knowledge/ 下文件（group scope 未指定 project_id 时返回聚合视图） */
export declare function listKnowledgeFiles(scope: KnowledgeScope, targetId: string, projectId?: string): Promise<KnowledgeFilesResponse>;
/** 读取单个 markdown / json 文件内容 */
export declare function getKnowledgeFile(scope: KnowledgeScope, targetId: string, path: string, projectId?: string): Promise<KnowledgeFileDetail>;
/** 写入 / 覆盖 markdown 内容（仅 .md 文件） */
export declare function saveKnowledgeFile(scope: KnowledgeScope, targetId: string, path: string, content: string, projectId?: string): Promise<KnowledgeFileDetail>;
/** 删除单个文件 */
export declare function deleteKnowledgeFile(scope: KnowledgeScope, targetId: string, path: string, projectId?: string): Promise<{
    ok: boolean;
}>;
/** 触发异步生成任务，返回当前任务状态快照 */
export declare function triggerKnowledgeGenerate(scope: KnowledgeScope, targetId: string, graphType?: KnowledgeGraphType): Promise<KnowledgeJob>;
/** 查询最近一次生成任务的状态 */
export declare function getKnowledgeStatus(scope: KnowledgeScope, targetId: string): Promise<KnowledgeJob>;
/** 导出知识图谱为 zip 文件并触发下载（携带认证 token） */
export declare function downloadKnowledgeExport(scope: KnowledgeScope, targetId: string, projectId?: string): Promise<void>;
/** @deprecated 使用 downloadKnowledgeExport 代替（此方法不携带 token，认证开启时会 401） */
export declare function getKnowledgeExportUrl(scope: KnowledgeScope, targetId: string, projectId?: string): string;
//# sourceMappingURL=knowledge.d.ts.map