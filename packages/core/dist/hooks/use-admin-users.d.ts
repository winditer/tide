import { type CreateUserInput, type ListUsersParams, type UpdateUserInput } from "../api/admin";
export declare function useAdminUsers(params?: ListUsersParams): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListUsersResponse>, Error>;
export declare function useAdminUser(userId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").AdminUser>, Error>;
export declare function useCreateAdminUser(): import("@tanstack/react-query").UseMutationResult<import("..").AdminUser, Error, CreateUserInput, unknown>;
export declare function useUpdateAdminUser(): import("@tanstack/react-query").UseMutationResult<import("..").AdminUser, Error, {
    userId: string;
    body: UpdateUserInput;
}, unknown>;
export declare function useDeleteAdminUser(): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
}, Error, string, unknown>;
export declare function useResetUserPassword(): import("@tanstack/react-query").UseMutationResult<{
    ok: boolean;
}, Error, {
    userId: string;
    newPassword: string;
}, unknown>;
export declare function useUserProjects(userId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListUserProjectsResponse>, Error>;
//# sourceMappingURL=use-admin-users.d.ts.map