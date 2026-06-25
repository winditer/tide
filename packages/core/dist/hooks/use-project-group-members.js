import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addGroupUserMember, listGroupUserMembers, removeGroupUserMember, updateGroupUserMember, } from "../api/project-group-members";
function membersKey(groupId) {
    return ["project-group-user-members", groupId];
}
export function useGroupUserMembers(groupId) {
    return useQuery({
        queryKey: ["project-group-user-members", groupId],
        queryFn: () => listGroupUserMembers(groupId),
        enabled: !!groupId,
    });
}
export function useAddGroupUserMember(groupId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => addGroupUserMember(groupId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: membersKey(groupId) });
        },
    });
}
export function useUpdateGroupUserMember(groupId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ userId, body, }) => updateGroupUserMember(groupId, userId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: membersKey(groupId) });
        },
    });
}
export function useRemoveGroupUserMember(groupId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId) => removeGroupUserMember(groupId, userId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: membersKey(groupId) });
        },
    });
}
//# sourceMappingURL=use-project-group-members.js.map