export interface DashboardStats {
    running: number;
    queued: number;
    pending_approval: number;
    completed_today: number;
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
export interface AgentInfo {
    id: string;
    name: string;
    available: boolean;
    running_tasks: number;
    queued_tasks: number;
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
}
export interface SessionsResponse {
    sessions: SessionInfo[];
}
export declare function getDashboardStats(): Promise<DashboardStats>;
export declare function getRecentTasks(limit?: number): Promise<RecentTasksResponse>;
export declare function getAgents(): Promise<AgentsResponse>;
export declare function getProjects(): Promise<ProjectsResponse>;
export declare function getSessions(): Promise<SessionsResponse>;
//# sourceMappingURL=dashboard.d.ts.map