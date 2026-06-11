import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAdminUser,
  deleteAdminUser,
  getAdminUser,
  getUserProjects,
  listUsers,
  resetUserPassword,
  updateAdminUser,
  type CreateUserInput,
  type ListUsersParams,
  type UpdateUserInput,
} from "../api/admin";

const USERS_KEY = ["admin", "users"] as const;

export function useAdminUsers(params: ListUsersParams = {}) {
  return useQuery({
    queryKey: [...USERS_KEY, params.q ?? "", params.page ?? 1, params.page_size ?? 20],
    queryFn: () => listUsers(params),
    placeholderData: (prev) => prev,
  });
}

export function useAdminUser(userId: string | undefined) {
  return useQuery({
    queryKey: [...USERS_KEY, "detail", userId],
    queryFn: () => getAdminUser(userId as string),
    enabled: !!userId,
  });
}

export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserInput) => createAdminUser(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
}

export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: UpdateUserInput }) =>
      updateAdminUser(userId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
}

export function useDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => deleteAdminUser(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      resetUserPassword(userId, newPassword),
  });
}

export function useUserProjects(userId: string | undefined) {
  return useQuery({
    queryKey: [...USERS_KEY, "projects", userId],
    queryFn: () => getUserProjects(userId as string),
    enabled: !!userId,
  });
}
