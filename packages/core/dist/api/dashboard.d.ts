export interface DashboardStats {
    running: number;
    queued: number;
    pending_approval: number;
    completed_today: number;
    /** 我的待办工作项总数（当前用户、未完成、有权限项目内）。 */
    my_work_items_count: number;
    /** 本周（周一 00:00 起）当前用户完成的工作项数。 */
    weekly_completed_work_items: number;
}
export interface RecentTask {
    id: string;
    prompt: string;
    agent_id: string | null;
    model: string | null;
    status: string;
    created_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    duration_ms: number | null;
}
export interface RecentTasksResponse {
    tasks: RecentTask[];
}
export interface AgentSkill {
    id?: string;
    name?: string;
    description?: string;
    tags?: string[];
    examples?: string[];
    [key: string]: unknown;
}
export interface AgentInfo {
    id: string;
    name: string;
    /** 'local' 表示本地 CLI Agent；'remote' 表示通过 A2A 协议接入的远程 Agent。 */
    type?: "local" | "remote";
    /** 仅本地 Agent 提供：CLI 是否可用 */
    available?: boolean;
    running_tasks?: number;
    queued_tasks?: number;
    /** 远程 Agent：注册描述 */
    description?: string | null;
    /** 远程 Agent：连通状态（active / inactive 等） */
    status?: string;
    /** 远程 Agent：声明的 skills 列表 */
    skills?: AgentSkill[];
    /** 远程 Agent：能力声明 */
    capabilities?: {
        streaming?: boolean;
        pushNotifications?: boolean;
        [key: string]: unknown;
    };
}
export interface AgentsResponse {
    agents: AgentInfo[];
}
export interface ProjectInfo {
    id: string;
    name: string;
    cwd: string;
    task_count: number;
    running_tasks: number;
    last_active: string | null;
    status: "active" | "idle";
    /** 项目初始化状态：ready=正常, initializing=正在克隆/初始化, error=出错 */
    init_status?: "ready" | "initializing" | "error";
    /** 当 init_status 为 error 时返回的错误信息 */
    init_error?: string | null;
    session_count?: number;
    /**
     * 项目维度的 Chats 数量。列表接口 ``GET /api/projects`` 为避免性能问题不计算，
     * 返回 ``null``；仅项目详情接口 ``GET /api/projects/{id}`` 返回精确数字。
     */
    chat_count?: number | null;
    archived?: boolean;
}
export interface ProjectsResponse {
    projects: ProjectInfo[];
}
export interface SessionInfo {
    session_id: string;
    agent_id: string | null;
    cwd: string | null;
    task_count: number;
    last_status: string;
    last_active: string | null;
    archived?: boolean;
}
export interface SessionsResponse {
    sessions: SessionInfo[];
    total?: number;
    page?: number;
    page_size?: number;
}
export declare function getDashboardStats(): Promise<DashboardStats>;
export declare function getRecentTasks(limit?: number): Promise<RecentTasksResponse>;
export declare function getAgents(): Promise<AgentsResponse>;
export declare function getProjects(params?: {
    show_archived?: boolean;
}): Promise<ProjectsResponse>;
export interface GetSessionsParams {
    project?: string;
    /** 项目组 id；仅返回属于该项目组的会话 */
    group_id?: string;
    agent_id?: string;
    page?: number;
    page_size?: number;
    show_archived?: boolean;
}
export declare function getSessions(params?: GetSessionsParams): Promise<SessionsResponse>;
export interface ActiveProject {
    id: string;
    name: string;
    description: string;
    task_count: number;
    running_count: number;
    last_active: string | null;
}
export interface ActivityEvent {
    id: number;
    event_type: string;
    task_id: string | null;
    task_title: string | null;
    project_name: string | null;
    payload: Record<string, unknown> | null;
    created_at: string | null;
}
export interface TaskStatusDistribution {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    review: number;
    [key: string]: number;
}
export interface UpcomingSchedule {
    id: string;
    name: string;
    schedule_type: string;
    next_run_at: string | null;
    last_run_at: string | null;
    enabled: boolean;
    run_count: number;
}
export declare function fetchActiveProjects(limit?: number): Promise<ActiveProject[]>;
export declare function fetchActivityTimeline(limit?: number): Promise<ActivityEvent[]>;
export declare function fetchTaskStatusDistribution(): Promise<TaskStatusDistribution>;
export declare function fetchUpcomingSchedules(limit?: number): Promise<UpcomingSchedule[]>;
/** “我的待办”中使用的精简工作项类型。
 *
 * 字段与 ``WorkItem`` 保持结构一致，额外包含后端推导出的
 * ``status`` 与 ``project_name``，避免前端为渲染一个列表重复调用项目 API。
 */
export interface MyWorkItem {
    id: string;
    project_id: string;
    workflow_id: string;
    current_node_id: string;
    title: string;
    description?: string | null;
    priority: number;
    assignee?: string | null;
    version_id?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    created_at: string | null;
    updated_at: string | null;
    /** 根据当前节点推导的状态。 */
    status?: "pending" | "in_progress" | "pending_approval" | "completed" | "failed" | "stopped" | "waiting";
    /** 项目名称，后端通过注册表 + cwd 末段解析。 */
    project_name?: string | null;
}
export interface ProjectProgress {
    id: string;
    name: string;
    total: number;
    completed: number;
}
/** 项目组进度汇总：返回组内所有工作项的总数与完成数。 */
export interface ProjectGroupProgress {
    id: string;
    name: string;
    description?: string | null;
    /** 项目组总成员项目数（含不可访问部分）。 */
    member_count: number;
    /** 当前用户可访问的项目数。 */
    accessible_member_count: number;
    total: number;
    completed: number;
    last_updated: string | null;
}
export declare function getMyWorkItems(limit?: number): Promise<MyWorkItem[]>;
export declare function getProjectProgress(limit?: number, groupId?: string): Promise<ProjectProgress[]>;
export declare function getGroupProgress(limit?: number): Promise<ProjectGroupProgress[]>;
//# sourceMappingURL=dashboard.d.ts.map