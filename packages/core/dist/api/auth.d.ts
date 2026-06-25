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
export declare function login(username: string, password: string): Promise<LoginResponse>;
export declare function refreshToken(refresh_token: string): Promise<RefreshResponse>;
export declare function logout(): Promise<{
    ok: boolean;
}>;
export declare function getMe(): Promise<AuthUser>;
/**
 * Build the Lark OAuth authorize URL on the backend. Use as `<a href>` so the
 * browser performs a full navigation (the backend issues a 302 to Lark).
 */
export declare function getLarkAuthorizeUrl(): string;
export interface ChangePasswordPayload {
    old_password: string;
    new_password: string;
}
export declare function changePassword(payload: ChangePasswordPayload): Promise<{
    ok: boolean;
}>;
//# sourceMappingURL=auth.d.ts.map