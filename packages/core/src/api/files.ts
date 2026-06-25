import { apiClient } from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileTreeNode[];
}

export interface FileTreeResponse {
  path: string;
  children: FileTreeNode[];
}

export interface SaveFileResponse {
  ok: boolean;
  path: string;
}

export interface ConflictDetail {
  base: string;
  ours: string;
  theirs: string;
  conflict_markers: string;
}

export interface ResolveConflictResponse {
  ok: boolean;
  file_path: string;
}

export interface AIResolveConflictParams {
  project_id: string;
  work_item_id?: string;
  file_path: string;
  base_content: string;
  ours_content: string;
  theirs_content: string;
}

export interface AIResolveConflictResponse {
  resolved_content: string;
  explanation: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Decode a URL-safe base64 projectId back to the original cwd path.
 * The encoding matches `encodeProjectId` in projects.ts.
 */
function decodeProjectId(projectId: string): string {
  let b64 = projectId.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  if (typeof window === "undefined") {
    return Buffer.from(b64, "base64").toString("utf-8");
  }
  const bin = atob(b64);
  return new TextDecoder().decode(
    Uint8Array.from(bin, (c) => c.charCodeAt(0)),
  );
}

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * 列出目录树。
 * @param projectId - 项目 ID（base64 encoded cwd）
 * @param path - 要列出的绝对目录路径
 * @param depth - 遍历深度（1-5）
 */
export function listDirectory(
  projectId: string,
  path: string,
  depth?: number,
): Promise<FileTreeResponse> {
  void projectId; // reserved for future auth scoping
  const qs = buildQuery({ path, depth });
  return apiClient.get<FileTreeResponse>(`/api/files/tree${qs}`);
}

/**
 * 读取文件内容（纯文本）。
 * @param projectId - 项目 ID
 * @param path - 文件的绝对路径
 */
export async function getFileContent(
  projectId: string,
  path: string,
): Promise<string> {
  void projectId;
  const qs = buildQuery({ path });
  return apiClient.get<string>(`/api/files/content${qs}`);
}

/**
 * 保存文件内容。
 * @param projectId - 项目 ID
 * @param path - 文件绝对路径
 * @param content - 文件内容
 */
export function saveFileContent(
  projectId: string,
  path: string,
  content: string,
): Promise<SaveFileResponse> {
  void projectId;
  return apiClient.put<SaveFileResponse>("/api/files/content", { path, content });
}

/**
 * 获取 Git diff。
 * @param projectId - 项目 ID（用于解析 cwd）
 * @param ref1 - 起始 ref
 * @param ref2 - 结束 ref
 * @param path - 特定文件路径
 */
export async function getFileDiff(
  projectId: string,
  ref1?: string,
  ref2?: string,
  path?: string,
): Promise<string> {
  const cwd = decodeProjectId(projectId);
  const qs = buildQuery({ cwd, ref1, ref2, path });
  return apiClient.get<string>(`/api/files/diff${qs}`);
}

/**
 * 获取冲突文件详情（base / ours / theirs）。
 */
export function getConflictDetail(
  projectId: string,
  cwd: string,
  filePath: string,
): Promise<ConflictDetail> {
  void projectId;
  const qs = buildQuery({ cwd, file_path: filePath });
  return apiClient.get<ConflictDetail>(`/api/files/conflict-detail${qs}`);
}

/**
 * 解决单个文件冲突：写入 resolvedContent 并 git add。
 */
export function resolveFileConflict(
  projectId: string,
  cwd: string,
  filePath: string,
  resolvedContent: string,
): Promise<ResolveConflictResponse> {
  void projectId;
  return apiClient.post<ResolveConflictResponse>("/api/files/resolve-conflict", {
    cwd,
    file_path: filePath,
    resolved_content: resolvedContent,
  });
}

/**
 * AI 解决冲突：通过 Agent 分析三方内容并返回合并结果。
 */
export function aiResolveConflict(
  params: AIResolveConflictParams,
): Promise<AIResolveConflictResponse> {
  return apiClient.post<AIResolveConflictResponse>(
    "/api/files/ai-resolve-conflict",
    params,
  );
}
