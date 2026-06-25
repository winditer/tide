import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { archiveProject, createProject, deleteProject, getProject, getProjectChats, getProjectRoots, getProjectSessions, getProjectTasks, unarchiveProject, } from "../api/projects";
export function useProject(projectId) {
    return useQuery({
        queryKey: ["project", projectId],
        queryFn: () => getProject(projectId),
        enabled: !!projectId,
    });
}
export function useProjectSessions(projectId, agentId) {
    return useQuery({
        queryKey: ["project-sessions", projectId, agentId !== null && agentId !== void 0 ? agentId : null],
        queryFn: () => getProjectSessions(projectId, agentId),
        enabled: !!projectId,
    });
}
export function useProjectChats(projectId, agentId) {
    return useQuery({
        queryKey: ["project-chats", projectId, agentId !== null && agentId !== void 0 ? agentId : null],
        queryFn: () => getProjectChats(projectId, agentId),
        enabled: !!projectId,
    });
}
export function useProjectTasks(projectId) {
    return useQuery({
        queryKey: ["project-tasks", projectId],
        queryFn: () => getProjectTasks(projectId),
        enabled: !!projectId,
    });
}
export function useCreateProject() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => createProject(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["projects"] });
        },
    });
}
export function useProjectRoots() {
    return useQuery({
        queryKey: ["project-roots"],
        queryFn: () => getProjectRoots(),
        staleTime: 5 * 60 * 1000,
    });
}
export function useDeleteProject() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (projectId) => deleteProject(projectId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["projects"] });
        },
    });
}
export function useArchiveProject() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (projectId) => archiveProject(projectId),
        onSuccess: (_, projectId) => {
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["project", projectId] });
        },
    });
}
export function useUnarchiveProject() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (projectId) => unarchiveProject(projectId),
        onSuccess: (_, projectId) => {
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["project", projectId] });
        },
    });
}
//# sourceMappingURL=use-projects.js.map