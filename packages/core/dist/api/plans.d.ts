import type { Plan, PlanDAGResponse, PlanTask, PlanDefinition, GanttItem } from "../types/plan";
export interface ListPlansParams {
    workspace_id?: string;
    status?: string;
    /** 按 plans.cwd 精确筛选 */
    project?: string;
    /** 按关联子任务的 session_id 筛选 */
    session_id?: string;
    /** 按 plans.group_id 精确筛选项目组 */
    group_id?: string;
    limit?: number;
    offset?: number;
}
export interface CreatePlanParams {
    definition: PlanDefinition;
    workspace_id?: string;
    cwd?: string;
    model?: string;
    /** 项目组工作区 ID：提供后默认 cwd 使用组 primary 项目路径 */
    group_id?: string;
}
export declare function getPlans(params?: ListPlansParams): Promise<Plan[]>;
export declare function getPlan(id: string): Promise<Plan>;
export declare function getPlanDAG(id: string): Promise<PlanDAGResponse>;
export declare function getPlanTasks(id: string): Promise<PlanTask[]>;
export declare function getPlanTimeline(id: string): Promise<GanttItem[]>;
export declare function createPlan(params: CreatePlanParams): Promise<Plan>;
export declare function stopPlan(id: string): Promise<Plan>;
export declare function retryPlanTask(planId: string, taskId: string): Promise<unknown>;
//# sourceMappingURL=plans.d.ts.map