import { type AddGroupMemberInput, type CreateProjectGroupInput, type UpdateProjectGroupInput } from "../api/project-groups";
/**
 * 拉取当前 workspace 下的所有项目组（不展开 members）。
 *
 * @example
 *   const { data } = useProjectGroups();
 *   const groups = data?.groups ?? [];
 */
export declare function useProjectGroups(workspaceId?: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListProjectGroupsResponse>, Error>;
/** 拉取单个项目组详情（含 members 列表）。 */
export declare function useProjectGroup(groupId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ProjectGroupDetail>, Error>;
export declare function useCreateProjectGroup(): import("@tanstack/react-query").UseMutationResult<import("..").ProjectGroupDetail, Error, CreateProjectGroupInput, unknown>;
export declare function useUpdateProjectGroup(): import("@tanstack/react-query").UseMutationResult<import("..").ProjectGroupDetail, Error, {
    groupId: string;
    body: UpdateProjectGroupInput;
}, unknown>;
export declare function useDeleteProjectGroup(): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
}, Error, string, unknown>;
export declare function useAddGroupMember(groupId: string): import("@tanstack/react-query").UseMutationResult<import("..").ProjectGroupMember, Error, AddGroupMemberInput, unknown>;
export declare function useRemoveGroupMember(groupId: string): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
}, Error, string, unknown>;
export declare function useGroupConversations(groupId: string | undefined, params?: {
    limit?: number;
    offset?: number;
}): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").PaginatedResponse<import("..").GroupConversationItem>>, Error>;
export declare function useGroupTasks(groupId: string | undefined, params?: {
    status?: string;
    limit?: number;
    offset?: number;
}): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").PaginatedResponse<import("..").GroupTaskItem>>, Error>;
export declare function useGroupVersions(groupId: string | undefined, params?: {
    limit?: number;
    offset?: number;
}): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").PaginatedResponse<import("..").GroupVersionItem>>, Error>;
export declare function useGroupWorkflow(groupId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").GroupWorkflowBinding>, Error>;
export declare function useSetGroupWorkflow(): import("@tanstack/react-query").UseMutationResult<import("..").GroupWorkflowBinding, Error, {
    groupId: string;
    workflowId: string;
}, unknown>;
export declare function useDeleteGroupWorkflow(): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
    group_id: string;
    workflow_id: null;
}, Error, string, unknown>;
//# sourceMappingURL=use-project-groups.d.ts.map