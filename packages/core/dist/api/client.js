const BASE_URL = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH) ||
    "";
export class ApiError extends Error {
    constructor(status, statusText, body) {
        super(`API Error ${status}: ${statusText}`);
        this.status = status;
        this.statusText = statusText;
        this.body = body;
        this.name = "ApiError";
    }
}
let authBridge = null;
export function installAuthBridge(bridge) {
    authBridge = bridge;
}
function buildHeaders(extra) {
    const headers = new Headers(extra);
    const token = authBridge === null || authBridge === void 0 ? void 0 : authBridge.getAccessToken();
    if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
}
/** Exported for cases where callers need to construct auth headers manually (e.g. blob downloads). */
export function buildAuthHeaders(extra) {
    return buildHeaders(extra);
}
async function readResponse(response) {
    // Read body as text exactly once to avoid "body stream already read" errors
    const raw = await response.text();
    const parse = () => {
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch (_a) {
            return raw;
        }
    };
    if (!response.ok) {
        throw new ApiError(response.status, response.statusText, parse());
    }
    return parse();
}
// ── Refresh-token coalescing ───────────────────────────────────────────────
//
// Multiple in-flight 401s should share a single refresh request to avoid
// stampeding the backend or rotating refresh tokens out from under each other.
let refreshInFlight = null;
async function attemptRefresh() {
    if (!authBridge)
        return null;
    const refreshToken = authBridge.getRefreshToken();
    if (!refreshToken)
        return null;
    if (refreshInFlight)
        return refreshInFlight;
    refreshInFlight = (async () => {
        try {
            const resp = await fetch(`${BASE_URL}/api/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: refreshToken }),
            });
            if (!resp.ok)
                return null;
            const data = (await resp.json());
            authBridge.onTokensRefreshed(data.access_token, data.refresh_token);
            return data.access_token;
        }
        catch (_a) {
            return null;
        }
        finally {
            refreshInFlight = null;
        }
    })();
    return refreshInFlight;
}
async function request(opts) {
    const headers = buildHeaders(opts.headers);
    let body;
    if (opts.rawBody !== undefined) {
        body = opts.rawBody;
    }
    else if (opts.body !== undefined) {
        if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        body = JSON.stringify(opts.body);
    }
    const response = await fetch(`${BASE_URL}${opts.path}`, {
        method: opts.method,
        headers,
        body,
    });
    if (response.status === 401 && !opts.skipAuthRetry && authBridge) {
        const newAccess = await attemptRefresh();
        if (newAccess) {
            const retryHeaders = buildHeaders(opts.headers);
            retryHeaders.set("Authorization", `Bearer ${newAccess}`);
            const retried = await fetch(`${BASE_URL}${opts.path}`, {
                method: opts.method,
                headers: retryHeaders,
                body,
            });
            return readResponse(retried);
        }
        // refresh failed → clear auth + bubble 401
        authBridge.onAuthFailure();
    }
    return readResponse(response);
}
export const apiClient = {
    get(path, init) {
        return request(Object.assign({ method: "GET", path }, init));
    },
    post(path, body, init) {
        return request(Object.assign({ method: "POST", path, body }, init));
    },
    put(path, body) {
        return request({ method: "PUT", path, body });
    },
    patch(path, body) {
        return request({ method: "PATCH", path, body });
    },
    del(path) {
        return request({ method: "DELETE", path });
    },
    /** Send arbitrary body (e.g. FormData) with auth header injection. */
    postRaw(path, rawBody, headers) {
        return request({ method: "POST", path, rawBody, headers });
    },
};
export const API_BASE_URL = BASE_URL;
//# sourceMappingURL=client.js.map