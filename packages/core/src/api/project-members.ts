import { apiClient } from "./client";

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

/** Lightweight user info for name resolution (may include non-members). */
export interface BasicUser {
  id: string;
  username: string;
  display_name: string | null;
}

export interface ListProjectMembersResponse {
  members: ProjectMember[];
  total: number;
  /** All system users (basic info) for resolving created_by / operator IDs to names. */
  all_users?: BasicUser[];
}

export interface AddMemberInput {
  user_id: string;
  role?: string;
}

export interface UpdateMemberInput {
  role: string;
}

export function listProjectMembers(
  projectId: string,
): Promise<ListProjectMembersResponse> {
  return apiClient.get<ListProjectMembersResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/members`,
  );
}

export function addProjectMember(
  projectId: string,
  body: AddMemberInput,
): Promise<unknown> {
  return apiClient.post(
    `/api/projects/${encodeURIComponent(projectId)}/members`,
    body,
  );
}

export function updateProjectMemberRole(
  projectId: string,
  userId: string,
  body: UpdateMemberInput,
): Promise<unknown> {
  return apiClient.put(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(
      userId,
    )}`,
    body,
  );
}

export function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<{ ok: boolean }> {
  return apiClient.del<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(
      userId,
    )}`,
  );
}

// ── Available users (for add-member dialog) ─────────────────────

export interface AvailableUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: string;
}

export interface ListAvailableUsersResponse {
  items: AvailableUser[];
  total: number;
}

export function listAvailableUsers(
  projectId: string,
  params?: { q?: string; page?: number; page_size?: number },
): Promise<ListAvailableUsersResponse> {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.page_size) sp.set("page_size", String(params.page_size));
  const qs = sp.toString();
  return apiClient.get<ListAvailableUsersResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/members/available${qs ? `?${qs}` : ""}`,
  );
}

export interface BatchAddMembersResponse {
  added: string[];
  skipped: Array<{ user_id: string; reason: string }>;
}

export function batchAddProjectMembers(
  projectId: string,
  body: { user_ids: string[]; role?: string },
): Promise<BatchAddMembersResponse> {
  return apiClient.post<BatchAddMembersResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/members/batch`,
    body,
  );
}
