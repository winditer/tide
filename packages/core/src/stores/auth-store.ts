"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface AuthUser {
  id: string;
  username: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: string;
  status?: string | null;
  workspace_id?: string | null;
  lark_open_id?: string | null;
  lark_union_id?: string | null;
}

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  hydrated: boolean;
  setAuth: (data: {
    accessToken: string;
    refreshToken: string;
    user?: AuthUser | null;
  }) => void;
  setUser: (user: AuthUser | null) => void;
  clearAuth: () => void;
  setHydrated: (v: boolean) => void;
}

export const TIDE_AUTH_STORAGE_KEY = "tide-auth-store";

/**
 * Zustand auth store, persisted to localStorage.
 *
 * Tokens and user info survive page reload. The `hydrated` flag flips to true
 * after Zustand finishes restoring state from storage on the client — useful
 * to avoid flickering redirects during SSR / first paint.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      hydrated: false,
      setAuth: ({ accessToken, refreshToken, user }) =>
        set((prev) => ({
          accessToken,
          refreshToken,
          user: user ?? prev.user ?? null,
        })),
      setUser: (user) => set({ user }),
      clearAuth: () =>
        set({ accessToken: null, refreshToken: null, user: null }),
      setHydrated: (v) => set({ hydrated: v }),
    }),
    {
      name: TIDE_AUTH_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : (undefined as unknown as Storage),
      ),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

/**
 * Non-React accessors for use inside the API client and other vanilla
 * JS modules. Reading from `useAuthStore.getState()` is fully reactive-safe
 * and won't trigger re-renders.
 */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

export function getRefreshToken(): string | null {
  return useAuthStore.getState().refreshToken;
}

export function setAuthTokens(data: {
  accessToken: string;
  refreshToken: string;
  user?: AuthUser | null;
}): void {
  useAuthStore.getState().setAuth(data);
}

export function clearAuthTokens(): void {
  useAuthStore.getState().clearAuth();
}

// 跨标签页同步：监听其他 tab 对 localStorage 的修改
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === TIDE_AUTH_STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        const state = parsed?.state;
        if (state) {
          useAuthStore.setState({
            accessToken: state.accessToken ?? null,
            refreshToken: state.refreshToken ?? null,
            user: state.user ?? null,
          });
        }
      } catch {
        // 忽略解析错误
      }
    }
    // 如果 key 被删除（其他标签页退出登录）
    if (event.key === TIDE_AUTH_STORAGE_KEY && event.newValue === null) {
      useAuthStore.setState({
        accessToken: null,
        refreshToken: null,
        user: null,
      });
    }
  });
}
