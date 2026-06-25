export interface ProjectDetail {
    id: string;
    name: string;
    cwd: string;
    task_count: number;
    running_tasks: number;
    last_active: string | null;
    status: "active" | "idle";
    agents: string[];
    session_count: number;
    /**
     * 项目维度的 Chats 数量。
     * - 列表接口 ``GET /api/projects`` 为避免性能问题不计算，返回 ``null``；
     * - 详情接口 ``GET /api/projects/{id}`` 返回精确计算后的数字。
     */
    chat_count: number | null;
    registered: boolean;
    tags: string[];
    archived?: boolean;
}
export interface ProjectSession {
    id?: string;
    session_id: string;
    agent_id: string | null;
    cwd: string | null;
    project_root: string | null;
    project_name: string | null;
    title: string | null;
    status: string;
    last_active: string | null;
    created_at: string | null;
    file?: string;
    source: string;
}
export interface ProjectSessionsResponse {
    sessions: ProjectSession[];
    project_id: string;
    cwd: string;
}
export interface ProjectChatsResponse {
    chats: ProjectSession[];
    project_id: string;
    cwd: string;
}
export interface ProjectTaskSummary {
    id: string;
    prompt: string;
    agent_id: string | null;
    status: string;
    created_at: string | null;
}
export interface ProjectTasksResponse {
    tasks: ProjectTaskSummary[];
}
export interface CreateProjectInput {
    name: string;
    mode: "new" | "clone";
    repo_url?: string;
    branch?: string;
    tags?: string[];
}
export interface ProjectRootsResponse {
    roots: string[];
    default: string | null;
}
export declare function getProject(projectId: string): Promise<ProjectDetail>;
export declare function getProjectSessions(projectId: string, agent_id?: string): Promise<ProjectSessionsResponse>;
export declare function getProjectChats(projectId: string, agent_id?: string): Promise<ProjectChatsResponse>;
export declare function getProjectTasks(projectId: string): Promise<ProjectTasksResponse>;
export declare function createProject(body: CreateProjectInput): Promise<ProjectDetail>;
export declare function getProjectRoots(): Promise<ProjectRootsResponse>;
export declare function deleteProject(projectId: string): Promise<{
    removed: boolean;
    cwd: string;
}>;
export interface ArchiveProjectResult {
    archived: boolean;
    changed: boolean;
    id: string;
    cwd: string;
}
export declare function archiveProject(projectId: string): Promise<ArchiveProjectResult>;
export declare function unarchiveProject(projectId: string): Promise<ArchiveProjectResult>;
/**
 * URL-safe base64 编码（不带 ``=`` padding）
 * 用于在客户端把 cwd 转成 project_id（与后端 ``_encode_id`` 保持一致）。
 */
export declare function encodeProjectId(cwd: string): string;
//# sourceMappingURL=projects.d.ts.map