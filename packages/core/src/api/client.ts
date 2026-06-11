const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

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

async function handleResponse<T>(response: Response): Promise<T> {
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

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`);
    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async put<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async del<T>(path: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "DELETE",
    });
    return handleResponse<T>(response);
  },
};
