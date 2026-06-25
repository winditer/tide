import { apiClient } from "./client";
/**
 * Username / password login.
 *
 * Returns a fresh access+refresh token pair plus the public user record.
 * Throws `ApiError` (401) on invalid credentials.
 */
export function login(username, password) {
    return apiClient.post("/api/auth/login", { username, password }, { skipAuthRetry: true });
}
export function refreshToken(refresh_token) {
    return apiClient.post("/api/auth/refresh", { refresh_token }, { skipAuthRetry: true });
}
export function logout() {
    return apiClient.post("/api/auth/logout");
}
export function getMe() {
    return apiClient.get("/api/auth/me");
}
/**
 * Build the Lark OAuth authorize URL on the backend. Use as `<a href>` so the
 * browser performs a full navigation (the backend issues a 302 to Lark).
 */
export function getLarkAuthorizeUrl() {
    const base = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
        (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH) ||
        "";
    return `${base}/api/auth/lark/authorize`;
}
export function changePassword(payload) {
    return apiClient.post("/api/auth/change-password", payload);
}
//# sourceMappingURL=auth.js.map