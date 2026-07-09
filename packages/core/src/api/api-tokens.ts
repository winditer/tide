import { apiClient } from "./client";

export interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface CreateApiTokenResponse {
  id: string;
  token: string;
  name: string;
  prefix: string;
  expires_at: string | null;
  created_at: string;
}

export function listApiTokens(): Promise<ApiTokenInfo[]> {
  return apiClient.get<ApiTokenInfo[]>("/api/api-tokens");
}

export function createApiToken(
  name: string,
  expires_days?: number,
): Promise<CreateApiTokenResponse> {
  return apiClient.post<CreateApiTokenResponse>("/api/api-tokens", {
    name,
    expires_days,
  });
}

export function revokeApiToken(tokenId: string): Promise<void> {
  return apiClient.del(`/api/api-tokens/${tokenId}`);
}
