import type { WorkItem, WorkItemCreate, WorkItemUpdate, WorkItemTransition, WorkItemBoard, ProjectSettings, WorkItemArtifact, CrossRepoResultsResponse } from "../types/work-item";
export interface WorkItemFilters {
    search?: string;
    status?: string;
    assignee?: string;
    version_id?: string;
    group_id?: string;
}
export declare function getWorkItems(projectId?: string, filters?: WorkItemFilters): Promise<WorkItem[]>;
export declare function getWorkItem(id: string): Promise<WorkItem>;
export declare function createWorkItem(data: WorkItemCreate): Promise<WorkItem>;
export declare function updateWorkItem(id: string, data: WorkItemUpdate): Promise<WorkItem>;
export declare function deleteWorkItem(id: string): Promise<void>;
export declare function transitionWorkItem(id: string, targetNodeId: string, operator?: string): Promise<WorkItemTransition>;
export declare function getWorkItemTransitions(id: string): Promise<WorkItemTransition[]>;
export declare function getWorkItemCrossRepoResults(id: string): Promise<CrossRepoResultsResponse>;
export declare function getWorkItemBoard(projectId: string, versionId?: string): Promise<WorkItemBoard>;
export declare function moveWorkItem(id: string, targetNodeId: string): Promise<WorkItemTransition>;
export declare function getProjectWorkflow(projectId: string): Promise<ProjectSettings>;
export declare function bindProjectWorkflow(projectId: string, workflowId: string): Promise<ProjectSettings>;
export declare function unbindProjectWorkflow(projectId: string): Promise<void>;
export declare function addArtifact(workItemId: string, data: {
    label: string;
    url: string;
    stage?: string;
    type?: string;
}): Promise<{
    artifacts: WorkItemArtifact[];
}>;
export declare function removeArtifact(workItemId: string, artifactId: string): Promise<{
    artifacts: WorkItemArtifact[];
}>;
//# sourceMappingURL=work-items.d.ts.map