import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addGroupMember, createProjectGroup, deleteGroupWorkflow, deleteProjectGroup, getGroupConversations, getGroupTasks, getGroupVersions, getGroupWorkflow, getProjectGroup, listProjectGroups, removeGroupMember, setGroupWorkflow, updateProjectGroup, } from "../api/project-groups";
const groupsKey = (workspaceId) => ["project-groups", workspaceId !== null && workspaceId !== void 0 ? workspaceId : "default"];
const groupKey = (groupId) => ["project-group", groupId];
const groupConversationsKey = (groupId, params) => {
    var _a, _b;
    return [
        "project-group",
        groupId,
        "conversations",
        (_a = params === null || params === void 0 ? void 0 : params.limit) !== null && _a !== void 0 ? _a : null,
        (_b = params === null || params === void 0 ? void 0 : params.offset) !== null && _b !== void 0 ? _b : null,
    ];
};
const groupTasksKey = (groupId, params) => {
    var _a, _b, _c;
    return [
        "project-group",
        groupId,
        "tasks",
        (_a = params === null || params === void 0 ? void 0 : params.status) !== null && _a !== void 0 ? _a : null,
        (_b = params === null || params === void 0 ? void 0 : params.limit) !== null && _b !== void 0 ? _b : null,
        (_c = params === null || params === void 0 ? void 0 : params.offset) !== null && _c !== void 0 ? _c : null,
    ];
};
const groupVersionsKey = (groupId, params) => {
    var _a, _b;
    return [
        "project-group",
        groupId,
        "versions",
        (_a = params === null || params === void 0 ? void 0 : params.limit) !== null && _a !== void 0 ? _a : null,
        (_b = params === null || params === void 0 ? void 0 : params.offset) !== null && _b !== void 0 ? _b : null,
    ];
};
const groupWorkflowKey = (groupId) => ["project-group", groupId, "workflow"];
/**
 * 拉取当前 workspace 下的所有项目组（不展开 members）。
 *
 * @example
 *   const { data } = useProjectGroups();
 *   const groups = data?.groups ?? [];
 */
export function useProjectGroups(workspaceId) {
    return useQuery({
        queryKey: groupsKey(workspaceId),
        queryFn: () => listProjectGroups(workspaceId),
    });
}
/** 拉取单个项目组详情（含 members 列表）。 */
export function useProjectGroup(groupId) {
    return useQuery({
        queryKey: groupKey(groupId !== null && groupId !== void 0 ? groupId : ""),
        queryFn: () => getProjectGroup(groupId),
        enabled: !!groupId,
    });
}
export function useCreateProjectGroup() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => createProjectGroup(body),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: groupsKey(vars.workspace_id) });
        },
    });
}
export function useUpdateProjectGroup() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ groupId, body, }) => updateProjectGroup(groupId, body),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["project-groups"] });
            qc.invalidateQueries({ queryKey: groupKey(vars.groupId) });
        },
    });
}
export function useDeleteProjectGroup() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (groupId) => deleteProjectGroup(groupId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["project-groups"] });
        },
    });
}
export function useAddGroupMember(groupId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => addGroupMember(groupId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["project-groups"] });
            qc.invalidateQueries({ queryKey: groupKey(groupId) });
        },
    });
}
export function useRemoveGroupMember(groupId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (projectId) => removeGroupMember(groupId, projectId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["project-groups"] });
            qc.invalidateQueries({ queryKey: groupKey(groupId) });
        },
    });
}
// ── 聚合查询 hooks ──────────────────────────────────────────────────────────
export function useGroupConversations(groupId, params) {
    return useQuery({
        queryKey: groupConversationsKey(groupId !== null && groupId !== void 0 ? groupId : "", params),
        queryFn: () => getGroupConversations(groupId, params),
        enabled: !!groupId,
    });
}
export function useGroupTasks(groupId, params) {
    return useQuery({
        queryKey: groupTasksKey(groupId !== null && groupId !== void 0 ? groupId : "", params),
        queryFn: () => getGroupTasks(groupId, params),
        enabled: !!groupId,
    });
}
export function useGroupVersions(groupId, params) {
    return useQuery({
        queryKey: groupVersionsKey(groupId !== null && groupId !== void 0 ? groupId : "", params),
        queryFn: () => getGroupVersions(groupId, params),
        enabled: !!groupId,
    });
}
export function useGroupWorkflow(groupId) {
    return useQuery({
        queryKey: groupWorkflowKey(groupId !== null && groupId !== void 0 ? groupId : ""),
        queryFn: () => getGroupWorkflow(groupId),
        enabled: !!groupId,
    });
}
export function useSetGroupWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ groupId, workflowId, }) => setGroupWorkflow(groupId, workflowId),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: groupWorkflowKey(vars.groupId) });
        },
    });
}
export function useDeleteGroupWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (groupId) => deleteGroupWorkflow(groupId),
        onSuccess: (_, groupId) => {
            qc.invalidateQueries({ queryKey: groupWorkflowKey(groupId) });
        },
    });
}
//# sourceMappingURL=use-project-groups.js.map