/** 项目组用户成员（JOIN users 后展平的扁平结构）。 */
export interface GroupUserMember {
    member_id: string;
    group_role: string;
    joined_at: string | null;
    /** 用户字段（来自 users 表 JOIN）。 */
    id: string;
    username: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    global_role: string | null;
    status: string | null;
    lark_open_id?: string | null;
}
export interface ListGroupUserMembersResponse {
    members: GroupUserMember[];
    total: number;
}
export interface AddGroupUserMemberInput {
    user_id: string;
    role?: string;
}
export interface UpdateGroupUserMemberInput {
    role: string;
}
export declare function listGroupUserMembers(groupId: string): Promise<ListGroupUserMembersResponse>;
export declare function addGroupUserMember(groupId: string, body: AddGroupUserMemberInput): Promise<unknown>;
export declare function updateGroupUserMember(groupId: string, userId: string, body: UpdateGroupUserMemberInput): Promise<unknown>;
export declare function removeGroupUserMember(groupId: string, userId: string): Promise<{
    ok: boolean;
}>;
//# sourceMappingURL=project-group-members.d.ts.map