import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAdminUser, deleteAdminUser, getAdminUser, getUserProjects, listUsers, resetUserPassword, updateAdminUser, } from "../api/admin";
const USERS_KEY = ["admin", "users"];
export function useAdminUsers(params = {}) {
    var _a, _b, _c;
    return useQuery({
        queryKey: [...USERS_KEY, (_a = params.q) !== null && _a !== void 0 ? _a : "", (_b = params.page) !== null && _b !== void 0 ? _b : 1, (_c = params.page_size) !== null && _c !== void 0 ? _c : 20],
        queryFn: () => listUsers(params),
        placeholderData: (prev) => prev,
    });
}
export function useAdminUser(userId) {
    return useQuery({
        queryKey: [...USERS_KEY, "detail", userId],
        queryFn: () => getAdminUser(userId),
        enabled: !!userId,
    });
}
export function useCreateAdminUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => createAdminUser(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: USERS_KEY });
        },
    });
}
export function useUpdateAdminUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ userId, body }) => updateAdminUser(userId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: USERS_KEY });
        },
    });
}
export function useDeleteAdminUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId) => deleteAdminUser(userId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: USERS_KEY });
        },
    });
}
export function useResetUserPassword() {
    return useMutation({
        mutationFn: ({ userId, newPassword }) => resetUserPassword(userId, newPassword),
    });
}
export function useUserProjects(userId) {
    return useQuery({
        queryKey: [...USERS_KEY, "projects", userId],
        queryFn: () => getUserProjects(userId),
        enabled: !!userId,
    });
}
//# sourceMappingURL=use-admin-users.js.map