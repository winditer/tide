import { type AddGroupUserMemberInput, type UpdateGroupUserMemberInput } from "../api/project-group-members";
export declare function useGroupUserMembers(groupId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListGroupUserMembersResponse>, Error>;
export declare function useAddGroupUserMember(groupId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, AddGroupUserMemberInput, unknown>;
export declare function useUpdateGroupUserMember(groupId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, {
    userId: string;
    body: UpdateGroupUserMemberInput;
}, unknown>;
export declare function useRemoveGroupUserMember(groupId: string): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
}, Error, string, unknown>;
//# sourceMappingURL=use-project-group-members.d.ts.map