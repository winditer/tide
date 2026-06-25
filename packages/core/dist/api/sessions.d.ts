import type { SessionInfo, SessionsResponse } from "./dashboard";
export type SessionType = "all" | "project" | "chat";
export interface ListSessionsParams {
    workspace_id?: string;
    project?: string;
    /** 项目组 id；仅返回属于该项目组的会话 */
    group_id?: string;
    agent_id?: string;
    type?: SessionType;
    page?: number;
    page_size?: number;
    show_archived?: boolean;
}
export interface ListChatsParams {
    agent_id?: string;
    page?: number;
    page_size?: number;
    show_archived?: boolean;
}
export interface SessionMessage {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: string | null;
    kind?: string;
}
export interface SessionRelatedTask {
    id: string;
    prompt: string | null;
    agent_id: string | null;
    status: string;
    cwd: string | null;
    created_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    duration_ms: number | null;
}
export interface SessionDetail {
    session: SessionInfo & {
        id?: string;
        file?: string | null;
        title?: string | null;
        project_root?: string | null;
        project_name?: string | null;
        created_at?: string | null;
        status?: string | null;
        source?: string;
    };
    messages: SessionMessage[];
    tasks: SessionRelatedTask[];
}
export interface CreateSessionInput {
    /** 项目工作目录；留空则创建普通对话（chat） */
    project_cwd?: string;
    agent_id?: string;
    title?: string;
    model?: string;
    workspace_id?: string;
    /** 会话类型：convo=项目会话，chat=普通对话；可以仅凭 cwd 推断 */
    session_type?: "convo" | "chat";
    /** 项目组 id；选中项目组时由后端注入多仓库上下文 */
    group_id?: string;
}
export interface CreateSessionResult {
    session_id: string;
    task_id: string | null;
    agent_id: string;
    cwd: string;
    title: string;
    status: string;
    session_type?: "convo" | "chat";
}
export interface SessionItem {
    id: string;
    title: string;
    agent_id: string;
    created_at: string;
    type: "project" | "chat";
}
export interface SessionsForProjectResponse {
    sessions: SessionItem[];
}
export declare function listSessions(params?: ListSessionsParams): Promise<SessionsResponse>;
/** 获取普通对话（非项目会话）列表，调用 GET /api/sessions/chats */
export declare function listChats(params?: ListChatsParams): Promise<SessionsResponse>;
export declare function getSession(sessionId: string, workspaceId?: string): Promise<SessionDetail>;
export declare function createSession(body: CreateSessionInput): Promise<CreateSessionResult>;
export declare function fetchSessionsForProject(cwd: string): Promise<SessionsForProjectResponse>;
export interface ArchiveSessionResult {
    archived: boolean;
    changed: boolean;
    id: string;
}
export declare function archiveSession(sessionId: string): Promise<ArchiveSessionResult>;
export declare function unarchiveSession(sessionId: string): Promise<ArchiveSessionResult>;
//# sourceMappingURL=sessions.d.ts.map