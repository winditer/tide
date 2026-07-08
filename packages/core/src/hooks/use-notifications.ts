import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../api/notifications";

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ["notifications", { unreadOnly }],
    queryFn: () => getNotifications(unreadOnly),
    refetchInterval: 30_000, // 每 30 秒轮询一次作为 WS 的兜底
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "count"],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
