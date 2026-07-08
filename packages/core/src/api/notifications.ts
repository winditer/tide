import { apiClient } from "./client";

export type NotificationType =
  | "assigned"
  | "completed"
  | "mentioned"
  | "task_completed"
  | "project_added";

export interface Notification {
  id: string;
  recipient_id: string;
  work_item_id: string;
  notification_type: NotificationType;
  trigger_actor_id?: string;
  content: string;
  is_read: number;
  created_at: string;
}

export interface NotificationListResponse {
  items: Notification[];
}

export interface UnreadCountResponse {
  count: number;
}

/** 获取通知列表（默认取最近 20 条，可只取未读） */
export function getNotifications(
  unreadOnly = false,
  limit = 20,
): Promise<NotificationListResponse> {
  const params = new URLSearchParams();
  if (unreadOnly) params.set("unread_only", "true");
  params.set("limit", String(limit));
  return apiClient.get<NotificationListResponse>(
    `/api/notifications?${params.toString()}`,
  );
}

/** 获取未读通知数量 */
export function getUnreadCount(): Promise<UnreadCountResponse> {
  return apiClient.get<UnreadCountResponse>("/api/notifications/count");
}

/** 将单条通知标记为已读 */
export function markNotificationRead(id: string): Promise<void> {
  return apiClient.post<void>(
    `/api/notifications/${encodeURIComponent(id)}/read`,
  );
}

/** 将全部通知标记为已读 */
export function markAllNotificationsRead(): Promise<void> {
  return apiClient.post<void>("/api/notifications/read-all");
}
