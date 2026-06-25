/** A project member, joined with the global user record. */
export interface ProjectMember {
    member_id: string;
    project_role: string;
    joined_at: string | null;
    /** Underlying user fields (flattened from the JOIN). */
    id: string;
    username: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    global_role: string | null;
    status: string | null;
    lark_open_id?: string | null;
}
export interface ListProjectMembersResponse {
    members: ProjectMember[];
    total: number;
}
export interface AddMemberInput {
    user_id: string;
    role?: string;
}
export interface UpdateMemberInput {
    role: string;
}
export declare function listProjectMembers(projectId: string): Promise<ListProjectMembersResponse>;
export declare function addProjectMember(projectId: string, body: AddMemberInput): Promise<unknown>;
export declare function updateProjectMemberRole(projectId: string, userId: string, body: UpdateMemberInput): Promise<unknown>;
export declare function removeProjectMember(projectId: string, userId: string): Promise<{
    ok: boolean;
}>;
//# sourceMappingURL=project-members.d.ts.map