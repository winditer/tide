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
}
export declare function listProjectGroups(workspaceId?: string): Promise<ListProjectGroupsResponse>;
export declare function getProjectGroup(groupId: string): Promise<ProjectGroupDetail>;
export declare function createProjectGroup(body: CreateProjectGroupInput): Promise<ProjectGroupDetail>;
export declare function updateProjectGroup(groupId: string, body: UpdateProjectGroupInput): Promise<ProjectGroupDetail>;
export declare function deleteProjectGroup(groupId: string): Promise<{
    ok: boolean;
}>;
export declare function addGroupMember(groupId: string, body: AddGroupMemberInput): Promise<ProjectGroupMember>;
export declare function removeGroupMember(groupId: string, projectId: string): Promise<{
    ok: boolean;
}>;
/** 拉取项目组聚合的会话列表（按 session_id 去重，按最后活跃时间倒序）。 */
export declare function getGroupConversations(groupId: string, params?: {
    limit?: number;
    offset?: number;
}): Promise<PaginatedResponse<GroupConversationItem>>;
/** 拉取项目组聚合的任务列表。 */
export declare function getGroupTasks(groupId: string, params?: {
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<PaginatedResponse<GroupTaskItem>>;
/** 拉取项目组聚合的版本列表（跨成员项目）。 */
export declare function getGroupVersions(groupId: string, params?: {
    limit?: number;
    offset?: number;
}): Promise<PaginatedResponse<GroupVersionItem>>;
export declare function getGroupWorkflow(groupId: string): Promise<GroupWorkflowBinding>;
export declare function setGroupWorkflow(groupId: string, workflowId: string): Promise<GroupWorkflowBinding>;
export declare function deleteGroupWorkflow(groupId: string): Promise<{
    ok: boolean;
    group_id: string;
    workflow_id: null;
}>;
//# sourceMappingURL=project-groups.d.ts.map