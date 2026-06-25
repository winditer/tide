import type { Task } from "../types/task";
export interface CreateTaskParams {
    prompt: string;
    agent_id?: string;
    model?: string;
    cwd?: string;
    session_id?: string;
    attachments?: string[];
    workspace_id?: string;
    /** 项目组 id；选中项目组时由后端注入多仓库上下文 */
    group_id?: string;
}
export interface ListTasksParams {
    workspace_id?: string;
    status?: string;
    agent_id?: string;
    project?: string;
    /** 项目组 id；仅返回 DB 中属于该项目组的任务 */
    group_id?: string;
    session_id?: string;
    created_after?: string;
    created_before?: string;
    page?: number;
    page_size?: number;
}
export interface ListTasksResponse {
    items: Task[];
    total: number;
    page: number;
    page_size: number;
}
export interface ApprovalAction {
    action: "approve" | "reject";
    reason?: string;
}
export declare function createTask(params: CreateTaskParams): Promise<Task>;
export interface UploadAttachmentsResponse {
    attachments: string[];
}
export declare function uploadTaskAttachments(files: File[]): Promise<UploadAttachmentsResponse>;
export declare function listTasks(params?: ListTasksParams): Promise<ListTasksResponse>;
export declare function getTask(id: string): Promise<Task>;
export declare function stopTask(id: string): Promise<Task>;
export declare function approveTask(id: string): Promise<Task>;
export declare function rejectTask(id: string, body?: ApprovalAction): Promise<Task>;
export declare function retryTask(id: string): Promise<Task>;
//# sourceMappingURL=tasks.d.ts.map