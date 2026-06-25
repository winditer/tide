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
export declare const TIDE_AUTH_STORAGE_KEY = "tide-auth-store";
/**
 * Zustand auth store, persisted to localStorage.
 *
 * Tokens and user info survive page reload. The `hydrated` flag flips to true
 * after Zustand finishes restoring state from storage on the client — useful
 * to avoid flickering redirects during SSR / first paint.
 */
export declare const useAuthStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<AuthState>, "persist"> & {
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<AuthState, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: AuthState) => void) => () => void;
        onFinishHydration: (fn: (state: AuthState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<AuthState, unknown>>;
    };
}>;
/**
 * Non-React accessors for use inside the API client and other vanilla
 * JS modules. Reading from `useAuthStore.getState()` is fully reactive-safe
 * and won't trigger re-renders.
 */
export declare function getAccessToken(): string | null;
export declare function getRefreshToken(): string | null;
export declare function setAuthTokens(data: {
    accessToken: string;
    refreshToken: string;
    user?: AuthUser | null;
}): void;
export declare function clearAuthTokens(): void;
//# sourceMappingURL=auth-store.d.ts.map