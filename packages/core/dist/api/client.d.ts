export declare class ApiError extends Error {
    status: number;
    statusText: string;
    body: unknown;
    constructor(status: number, statusText: string, body: unknown);
}
interface AuthBridge {
    getAccessToken: () => string | null;
    getRefreshToken: () => string | null;
    onTokensRefreshed: (access: string, refresh: string) => void;
    onAuthFailure: () => void;
}
export declare function installAuthBridge(bridge: AuthBridge): void;
/** Exported for cases where callers need to construct auth headers manually (e.g. blob downloads). */
export declare function buildAuthHeaders(extra?: HeadersInit): Headers;
export declare const apiClient: {
    get<T>(path: string, init?: {
        skipAuthRetry?: boolean;
    }): Promise<T>;
    post<T>(path: string, body?: unknown, init?: {
        skipAuthRetry?: boolean;
    }): Promise<T>;
    put<T>(path: string, body?: unknown): Promise<T>;
    patch<T>(path: string, body?: unknown): Promise<T>;
    del<T>(path: string): Promise<T>;
    /** Send arbitrary body (e.g. FormData) with auth header injection. */
    postRaw<T>(path: string, rawBody: BodyInit, headers?: HeadersInit): Promise<T>;
};
export declare const API_BASE_URL: string;
export {};
//# sourceMappingURL=client.d.ts.map