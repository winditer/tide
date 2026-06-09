export declare class ApiError extends Error {
    status: number;
    statusText: string;
    body: unknown;
    constructor(status: number, statusText: string, body: unknown);
}
export declare const apiClient: {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    put<T>(path: string, body?: unknown): Promise<T>;
    del<T>(path: string): Promise<T>;
};
//# sourceMappingURL=client.d.ts.map