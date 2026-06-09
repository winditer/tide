import type { Task } from "../types/task";
export interface CreateTaskParams {
    prompt: string;
    agent_id?: string;
    model?: string;
    cwd?: string;
    attachments?: string[];
    workspace_id?: string;
}
export interface ListTasksParams {
    workspace_id?: string;
    status?: string;
    agent_id?: string;
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
export declare function listTasks(params?: ListTasksParams): Promise<ListTasksResponse>;
export declare function getTask(id: string): Promise<Task>;
export declare function stopTask(id: string): Promise<Task>;
export declare function approveTask(id: string): Promise<Task>;
export declare function rejectTask(id: string, body?: ApprovalAction): Promise<Task>;
export declare function retryTask(id: string): Promise<Task>;
//# sourceMappingURL=tasks.d.ts.map