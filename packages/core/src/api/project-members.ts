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
