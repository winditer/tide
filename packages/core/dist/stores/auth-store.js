"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
export const TIDE_AUTH_STORAGE_KEY = "tide-auth-store";
/**
 * Zustand auth store, persisted to localStorage.
 *
 * Tokens and user info survive page reload. The `hydrated` flag flips to true
 * after Zustand finishes restoring state from storage on the client — useful
 * to avoid flickering redirects during SSR / first paint.
 */
export const useAuthStore = create()(persist((set) => ({
    accessToken: null,
    refreshToken: null,
    user: null,
    hydrated: false,
    setAuth: ({ accessToken, refreshToken, user }) => set((prev) => {
        var _a;
        return ({
            accessToken,
            refreshToken,
            user: (_a = user !== null && user !== void 0 ? user : prev.user) !== null && _a !== void 0 ? _a : null,
        });
    }),
    setUser: (user) => set({ user }),
    clearAuth: () => set({ accessToken: null, refreshToken: null, user: null }),
    setHydrated: (v) => set({ hydrated: v }),
}), {
    name: TIDE_AUTH_STORAGE_KEY,
    storage: createJSONStorage(() => typeof window !== "undefined"
        ? window.localStorage
        : undefined),
    partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
    }),
    onRehydrateStorage: () => (state) => {
        state === null || state === void 0 ? void 0 : state.setHydrated(true);
    },
}));
/**
 * Non-React accessors for use inside the API client and other vanilla
 * JS modules. Reading from `useAuthStore.getState()` is fully reactive-safe
 * and won't trigger re-renders.
 */
export function getAccessToken() {
    return useAuthStore.getState().accessToken;
}
export function getRefreshToken() {
    return useAuthStore.getState().refreshToken;
}
export function setAuthTokens(data) {
    useAuthStore.getState().setAuth(data);
}
export function clearAuthTokens() {
    useAuthStore.getState().clearAuth();
}
//# sourceMappingURL=auth-store.js.map