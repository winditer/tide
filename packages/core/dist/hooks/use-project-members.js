import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addProjectMember, listProjectMembers, removeProjectMember, updateProjectMemberRole, } from "../api/project-members";
function membersKey(projectId) {
    return ["project-members", projectId];
}
export function useProjectMembers(projectId) {
    return useQuery({
        queryKey: ["project-members", projectId],
        queryFn: () => listProjectMembers(projectId),
        enabled: !!projectId,
    });
}
export function useAddProjectMember(projectId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => addProjectMember(projectId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: membersKey(projectId) });
        },
    });
}
export function useUpdateProjectMember(projectId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ userId, body }) => updateProjectMemberRole(projectId, userId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: membersKey(projectId) });
        },
    });
}
export function useRemoveProjectMember(projectId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId) => removeProjectMember(projectId, userId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: membersKey(projectId) });
        },
    });
}
//# sourceMappingURL=use-project-members.js.map