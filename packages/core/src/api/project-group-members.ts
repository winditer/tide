import { apiClient } from "./client";

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

export function listGroupUserMembers(
  groupId: string,
): Promise<ListGroupUserMembersResponse> {
  return apiClient.get<ListGroupUserMembersResponse>(
    `/api/project-groups/${encodeURIComponent(groupId)}/users`,
  );
}

export function addGroupUserMember(
  groupId: string,
  body: AddGroupUserMemberInput,
): Promise<unknown> {
  return apiClient.post(
    `/api/project-groups/${encodeURIComponent(groupId)}/users`,
    body,
  );
}

export function updateGroupUserMember(
  groupId: string,
  userId: string,
  body: UpdateGroupUserMemberInput,
): Promise<unknown> {
  return apiClient.put(
    `/api/project-groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(
      userId,
    )}`,
    body,
  );
}

export function removeGroupUserMember(
  groupId: string,
  userId: string,
): Promise<{ ok: boolean }> {
  return apiClient.del<{ ok: boolean }>(
    `/api/project-groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(
      userId,
    )}`,
  );
}
