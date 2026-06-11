const BASE_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
  "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = "ApiError";
  }
}

// ── Auth integration ───────────────────────────────────────────────────────
//
// We avoid importing the auth store at module top level because the store
// pulls in Zustand + persist (a client-only chain). Instead, callers register
// hooks via `installAuthBridge` once during app bootstrap. If no bridge is
// installed (e.g. in Node tests), the client falls back to anonymous fetch.

interface AuthBridge {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  onTokensRefreshed: (access: string, refresh: string) => void;
  onAuthFailure: () => void;
}

let authBridge: AuthBridge | null = null;

export function installAuthBridge(bridge: AuthBridge): void {
  authBridge = bridge;
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = authBridge?.getAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function readResponse<T>(response: Response): Promise<T> {
  // Read body as text exactly once to avoid "body stream already read" errors
  const raw = await response.text();
  const parse = (): unknown => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, parse());
  }
  return parse() as T;
}

// ── Refresh-token coalescing ───────────────────────────────────────────────
//
// Multiple in-flight 401s should share a single refresh request to avoid
// stampeding the backend or rotating refresh tokens out from under each other.

let refreshInFlight: Promise<string | null> | null = null;

async function attemptRefresh(): Promise<string | null> {
  if (!authBridge) return null;
  const refreshToken = authBridge.getRefreshToken();
  if (!refreshToken) return null;

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const resp = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        access_token: string;
        refresh_token: string;
      };
      authBridge!.onTokensRefreshed(data.access_token, data.refresh_token);
      return data.access_token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  headers?: HeadersInit;
  /** When true, body is sent as-is (e.g. FormData) without JSON encoding. */
  rawBody?: BodyInit;
  /** Skip 401 → refresh interceptor (used internally for /auth endpoints). */
  skipAuthRetry?: boolean;
}

async function request<T>(opts: RequestOptions): Promise<T> {
  const headers = buildHeaders(opts.headers);
  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
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
      return readResponse<T>(retried);
    }
    // refresh failed → clear auth + bubble 401
    authBridge.onAuthFailure();
  }

  return readResponse<T>(response);
}

export const apiClient = {
  get<T>(path: string, init?: { skipAuthRetry?: boolean }): Promise<T> {
    return request<T>({ method: "GET", path, ...init });
  },
  post<T>(
    path: string,
    body?: unknown,
    init?: { skipAuthRetry?: boolean },
  ): Promise<T> {
    return request<T>({ method: "POST", path, body, ...init });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>({ method: "PUT", path, body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>({ method: "PATCH", path, body });
  },
  del<T>(path: string): Promise<T> {
    return request<T>({ method: "DELETE", path });
  },
  /** Send arbitrary body (e.g. FormData) with auth header injection. */
  postRaw<T>(path: string, rawBody: BodyInit, headers?: HeadersInit): Promise<T> {
    return request<T>({ method: "POST", path, rawBody, headers });
  },
};

export const API_BASE_URL = BASE_URL;
