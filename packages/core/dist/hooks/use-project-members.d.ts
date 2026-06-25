import { type AddMemberInput, type UpdateMemberInput } from "../api/project-members";
export declare function useProjectMembers(projectId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListProjectMembersResponse>, Error>;
export declare function useAddProjectMember(projectId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, AddMemberInput, unknown>;
export declare function useUpdateProjectMember(projectId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, {
    userId: string;
    body: UpdateMemberInput;
}, unknown>;
export declare function useRemoveProjectMember(projectId: string): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
}, Error, string, unknown>;
//# sourceMappingURL=use-project-members.d.ts.map