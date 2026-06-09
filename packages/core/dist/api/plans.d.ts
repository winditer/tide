import type { Plan, PlanDAGResponse, PlanTask, PlanDefinition, GanttItem } from "../types/plan";
export interface ListPlansParams {
    workspace_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
}
export interface CreatePlanParams {
    definition: PlanDefinition;
    workspace_id?: string;
    cwd?: string;
    model?: string;
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