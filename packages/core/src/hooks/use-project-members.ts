import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
  updateProjectMemberRole,
  type AddMemberInput,
  type UpdateMemberInput,
} from "../api/project-members";

function membersKey(projectId: string) {
  return ["project-members", projectId] as const;
}

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => listProjectMembers(projectId as string),
    enabled: !!projectId,
  });
}

export function useAddProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMemberInput) => addProjectMember(projectId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(projectId) });
    },
  });
}

export function useUpdateProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: UpdateMemberInput }) =>
      updateProjectMemberRole(projectId, userId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(projectId) });
    },
  });
}

export function useRemoveProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(projectId) });
    },
  });
}
