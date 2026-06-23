"use client";

import { useCallback, useEffect, useRef } from "react";
import { installAuthBridge } from "../api/client";
import {
  getMe,
  login as apiLogin,
  logout as apiLogout,
} from "../api/auth";
import {
  useAuthStore,
  type AuthState,
  type AuthUser,
} from "../stores/auth-store";

/**
 * Tide auth requirement flag.
 *
 * The frontend mirrors the backend's `TIDE_REQUIRE_AUTH` via the
 * `NEXT_PUBLIC_TIDE_REQUIRE_AUTH` env var (set to "1" to enforce login).
 * When falsy, anonymous browsing is allowed and login is purely opt-in.
 *
 * NOTE: `NEXT_PUBLIC_*` env vars are inlined at build time by the bundler,
 * so there is no runtime dependency on the `process` global existing in the
 * browser. Avoid guarding with `typeof process === "undefined"` — that
 * short-circuits the function before reaching the (already-inlined) literal.
 */
export function isAuthRequired(): boolean {
  return process.env.NEXT_PUBLIC_TIDE_REQUIRE_AUTH === "1";
}

let bridgeInstalled = false;

/**
 * Install the API client ↔ auth-store bridge exactly once per page load.
 * Called by `useAuth` so any page that reads auth state automatically wires
 * up the Authorization header + 401 → refresh interceptor.
 */
function ensureAuthBridge(): void {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  installAuthBridge({
    getAccessToken: () => useAuthStore.getState().accessToken,
    getRefreshToken: () => useAuthStore.getState().refreshToken,
    onTokensRefreshed: (access, refresh) => {
      useAuthStore.getState().setAuth({
        accessToken: access,
        refreshToken: refresh,
      });
    },
    onAuthFailure: () => {
      useAuthStore.getState().clearAuth();
    },
  });
}

/** Strip Lark OAuth query params from the URL bar without a re-render. */
function consumeUrlParams(): { token?: string; refresh?: string; error?: string } | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token") || undefined;
  const refresh = url.searchParams.get("refresh_token") || undefined;
  const error = url.searchParams.get("auth_error") || undefined;
  if (!token && !refresh && !error) return null;
  url.searchParams.delete("token");
  url.searchParams.delete("refresh_token");
  url.searchParams.delete("auth_error");
  window.history.replaceState({}, "", url.toString());
  return { token, refresh, error };
}

export interface UseAuthResult {
  user: AuthState["user"];
  accessToken: string | null;
  isAuthenticated: boolean;
  hydrated: boolean;
  authRequired: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
}

/**
 * Primary auth hook for client components.
 *
 * Responsibilities:
 *  - Install the API client auth bridge (Authorization header + 401 retry).
 *  - Consume Lark OAuth tokens delivered via `?token=&refresh_token=` after a
 *    callback redirect, persist them, and clean up the URL.
 *  - Expose login / logout / refreshUser actions wired to the persisted store.
 */
export function useAuth(): UseAuthResult {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setUser = useAuthStore((s) => s.setUser);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const consumedRef = useRef(false);

  // Install bridge synchronously on first render.
  ensureAuthBridge();

  // Capture Lark OAuth callback params on mount.
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const params = consumeUrlParams();
    if (params?.token && params.refresh) {
      setAuth({ accessToken: params.token, refreshToken: params.refresh });
      // Fetch profile lazily; UI doesn't need to block on it.
      getMe()
        .then((u) => setUser(u))
        .catch(() => undefined);
    }
  }, [setAuth, setUser]);

  // After hydration, if we have a token but no profile, fetch it once.
  useEffect(() => {
    if (!hydrated) return;
    if (accessToken && !user) {
      getMe()
        .then((u) => setUser(u))
        .catch(() => undefined);
    }
  }, [hydrated, accessToken, user, setUser]);

  const login = useCallback(
    async (username: string, password: string) => {
      const resp = await apiLogin(username, password);
      setAuth({
        accessToken: resp.access_token,
        refreshToken: resp.refresh_token,
        user: resp.user,
      });
      return resp.user;
    },
    [setAuth],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // best-effort; clear local state regardless
    }
    clearAuth();
  }, [clearAuth]);

  const refreshUser = useCallback(async () => {
    try {
      const u = await getMe();
      setUser(u);
      return u;
    } catch {
      return null;
    }
  }, [setUser]);

  return {
    user,
    accessToken,
    isAuthenticated: Boolean(accessToken),
    hydrated,
    authRequired: isAuthRequired(),
    login,
    logout,
    refreshUser,
  };
}
