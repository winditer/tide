var _a;
const BASE_URL = (_a = process.env.NEXT_PUBLIC_API_BASE_URL) !== null && _a !== void 0 ? _a : "http://localhost:8000";
export class ApiError extends Error {
    constructor(status, statusText, body) {
        super(`API Error ${status}: ${statusText}`);
        this.status = status;
        this.statusText = statusText;
        this.body = body;
        this.name = "ApiError";
    }
}
async function handleResponse(response) {
    if (!response.ok) {
        let body;
        try {
            body = await response.json();
        }
        catch (_a) {
            body = await response.text();
        }
        throw new ApiError(response.status, response.statusText, body);
    }
    return response.json();
}
export const apiClient = {
    async get(path) {
        const response = await fetch(`${BASE_URL}${path}`);
        return handleResponse(response);
    },
    async post(path, body) {
        const response = await fetch(`${BASE_URL}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
        });
        return handleResponse(response);
    },
    async put(path, body) {
        const response = await fetch(`${BASE_URL}${path}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
        });
        return handleResponse(response);
    },
    async del(path) {
        const response = await fetch(`${BASE_URL}${path}`, {
            method: "DELETE",
        });
        return handleResponse(response);
    },
};
//# sourceMappingURL=client.js.map