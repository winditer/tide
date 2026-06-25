import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addGroupUserMember,
  listGroupUserMembers,
  removeGroupUserMember,
  updateGroupUserMember,
  type AddGroupUserMemberInput,
  type UpdateGroupUserMemberInput,
} from "../api/project-group-members";

function membersKey(groupId: string) {
  return ["project-group-user-members", groupId] as const;
}

export function useGroupUserMembers(groupId: string | undefined) {
  return useQuery({
    queryKey: ["project-group-user-members", groupId],
    queryFn: () => listGroupUserMembers(groupId as string),
    enabled: !!groupId,
  });
}

export function useAddGroupUserMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddGroupUserMemberInput) =>
      addGroupUserMember(groupId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(groupId) });
    },
  });
}

export function useUpdateGroupUserMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      body,
    }: {
      userId: string;
      body: UpdateGroupUserMemberInput;
    }) => updateGroupUserMember(groupId, userId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(groupId) });
    },
  });
}

export function useRemoveGroupUserMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeGroupUserMember(groupId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(groupId) });
    },
  });
}
