import { apiClient } from "./client";

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

export function listUsers(params: ListUsersParams = {}): Promise<ListUsersResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.page) sp.set("page", String(params.page));
  if (params.page_size) sp.set("page_size", String(params.page_size));
  const qs = sp.toString();
  return apiClient.get<ListUsersResponse>(
    `/api/admin/users${qs ? `?${qs}` : ""}`,
  );
}

export function getAdminUser(userId: string): Promise<AdminUser> {
  return apiClient.get<AdminUser>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
  );
}

export function createAdminUser(body: CreateUserInput): Promise<AdminUser> {
  return apiClient.post<AdminUser>("/api/admin/users", body);
}

export function updateAdminUser(
  userId: string,
  body: UpdateUserInput,
): Promise<AdminUser> {
  return apiClient.put<AdminUser>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
    body,
  );
}

export function deleteAdminUser(userId: string): Promise<{ ok: boolean }> {
  return apiClient.del<{ ok: boolean }>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
  );
}

export function resetUserPassword(
  userId: string,
  new_password: string,
): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(
    `/api/admin/users/${encodeURIComponent(userId)}/reset-password`,
    { new_password },
  );
}

export function getUserProjects(
  userId: string,
): Promise<ListUserProjectsResponse> {
  return apiClient.get<ListUserProjectsResponse>(
    `/api/admin/users/${encodeURIComponent(userId)}/projects`,
  );
}
