import { apiClient } from "./client";
import type { AuthUser } from "../stores/auth-store";

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

/**
 * Username / password login.
 *
 * Returns a fresh access+refresh token pair plus the public user record.
 * Throws `ApiError` (401) on invalid credentials.
 */
export function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  return apiClient.post<LoginResponse>(
    "/api/auth/login",
    { username, password },
    { skipAuthRetry: true },
  );
}

export function refreshToken(refresh_token: string): Promise<RefreshResponse> {
  return apiClient.post<RefreshResponse>(
    "/api/auth/refresh",
    { refresh_token },
    { skipAuthRetry: true },
  );
}

export function logout(): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>("/api/auth/logout");
}

export function getMe(): Promise<AuthUser> {
  return apiClient.get<AuthUser>("/api/auth/me");
}

/**
 * Build the Lark OAuth authorize URL on the backend. Use as `<a href>` so the
 * browser performs a full navigation (the backend issues a 302 to Lark).
 */
export function getLarkAuthorizeUrl(): string {
  const base =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH) ||
    "";
  return `${base}/api/auth/lark/authorize`;
}

export interface ChangePasswordPayload {
  old_password: string;
  new_password: string;
}

export function changePassword(
  payload: ChangePasswordPayload,
): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>("/api/auth/change-password", payload);
}
