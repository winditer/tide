import { type AuthState, type AuthUser } from "../stores/auth-store";
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
export declare function isAuthRequired(): boolean;
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
export declare function useAuth(): UseAuthResult;
//# sourceMappingURL=useAuth.d.ts.map