/** Public user record returned by admin endpoints (password fields stripped). */
export interface AdminUser {
    id: string;
    username: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    role: string;
    status: string | null;
    lark_open_id?: string | null;
    lark_union_id?: string | null;
    workspace_id?: string | null;
    last_login_at?: string | null;
    created_at: string | null;
    updated_at: string | null;
}
export interface ListUsersParams {
    q?: string;
    page?: number;
    page_size?: number;
}
export interface ListUsersResponse {
    users: AdminUser[];
    total: number;
    page: number;
    page_size: number;
}
export interface CreateUserInput {
    username: string;
    password: string;
    email?: string;
    role?: string;
    display_name?: string;
}
export interface UpdateUserInput {
    email?: string;
    role?: string;
    display_name?: string;
    status?: string;
}
export interface UserProjectAssignment {
    project_id: string;
    role: string;
    created_at: string | null;
}
export interface ListUserProjectsResponse {
    projects: UserProjectAssignment[] | string[];
    is_admin: boolean;
}
export declare function listUsers(params?: ListUsersParams): Promise<ListUsersResponse>;
export declare function getAdminUser(userId: string): Promise<AdminUser>;
export declare function createAdminUser(body: CreateUserInput): Promise<AdminUser>;
export declare function updateAdminUser(userId: string, body: UpdateUserInput): Promise<AdminUser>;
export declare function deleteAdminUser(userId: string): Promise<{
    ok: boolean;
}>;
export declare function resetUserPassword(userId: string, new_password: string): Promise<{
    ok: boolean;
}>;
export declare function getUserProjects(userId: string): Promise<ListUserProjectsResponse>;
//# sourceMappingURL=admin.d.ts.map