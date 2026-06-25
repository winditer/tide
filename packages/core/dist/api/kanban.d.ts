import type { KanbanBoard, AgentSwimlane, MoveCardInput } from "../types/kanban";
export interface KanbanQueryParams {
    workspace_id?: string;
    group_id?: string;
    project_id?: string;
}
export declare function fetchProjectBoard(params?: KanbanQueryParams): Promise<KanbanBoard>;
export declare function fetchSessionBoard(params?: KanbanQueryParams): Promise<KanbanBoard>;
export declare function fetchAgentBoard(params?: KanbanQueryParams): Promise<AgentSwimlane[]>;
export declare function fetchWorkflowBoard(params?: KanbanQueryParams): Promise<KanbanBoard>;
export declare function moveCard(input: MoveCardInput): Promise<{
    ok: boolean;
}>;
//# sourceMappingURL=kanban.d.ts.map