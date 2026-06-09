import type { KanbanQueryParams } from "../api/kanban";
import type { MoveCardInput } from "../types/kanban";
export declare function useProjectBoard(params?: KanbanQueryParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").KanbanBoard>, Error>;
export declare function useSessionBoard(params?: KanbanQueryParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").KanbanBoard>, Error>;
export declare function useAgentBoard(params?: KanbanQueryParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").AgentSwimlane[]>, Error>;
export declare function useWorkflowBoard(params?: KanbanQueryParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").KanbanBoard>, Error>;
export declare function useMoveCard(): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
}, Error, MoveCardInput, unknown>;
//# sourceMappingURL=use-kanban.d.ts.map