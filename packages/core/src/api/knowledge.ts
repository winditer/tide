import { apiClient, API_BASE_URL, buildAuthHeaders } from "./client";

/** 知识图谱所属范围：单个项目 / 项目组 */
export type KnowledgeScope = "project" | "group";

/** 图谱类型：全部 / 模块依赖 / API / 数据库 / 业务概念 */
export type KnowledgeGraphType = "all" | "module" | "api" | "db" | "concept";

/** 任务状态：空闲 / 待启动 / 运行中 / 完成 / 失败 */
export type KnowledgeJobStatus =
  | "idle"
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface KnowledgeFileEntry {
  /** 相对 .knowledge/ 的路径，例如 "module/index.md" */
  path: string;
  name: string;
  ext: string;
  size: number;
  modified_at?: string | null;
}

export interface KnowledgeMeta {
  schema_version?: string;
  version?: number;
  repo_name?: string;
  git_commit?: string;
  git_branch?: string;
  generated_at?: string;
  generator?: string;
  sections?: string[];
}

export interface KnowledgeRepoFiles {
  project_id: string;
  name: string;
  cwd: string;
  files: KnowledgeFileEntry[];
  meta?: KnowledgeMeta | null;
}

export interface KnowledgeFilesResponse {
  scope: KnowledgeScope;
  target_id: string;
  repos: KnowledgeRepoFiles[];
}

export interface KnowledgeFileDetail extends KnowledgeFileEntry {
  content: string;
  project_id?: string;
}

export interface KnowledgeJobRepo {
  project_id: string;
  cwd: string;
  name: string;
}

export interface KnowledgeJobLog {
  repo: string;
  cwd: string;
  returncode: number;
  stdout_tail?: string;
  stderr_tail?: string;
}

export interface KnowledgeJob {
  job_id?: string;
  scope: KnowledgeScope;
  target_id: string;
  graph_type?: KnowledgeGraphType;
  status: KnowledgeJobStatus;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  repos?: KnowledgeJobRepo[];
  progress?: { total: number; done: number; current?: string | null };
  logs?: KnowledgeJobLog[];
}

function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, v);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** 列出 .knowledge/ 下文件（group scope 未指定 project_id 时返回聚合视图） */
export function listKnowledgeFiles(
  scope: KnowledgeScope,
  targetId: string,
  projectId?: string,
): Promise<KnowledgeFilesResponse> {
  return apiClient.get<KnowledgeFilesResponse>(
    `/api/knowledge/${scope}/${encodeURIComponent(targetId)}/files${buildQuery({ project_id: projectId })}`,
  );
}

/** 读取单个 markdown / json 文件内容 */
export function getKnowledgeFile(
  scope: KnowledgeScope,
  targetId: string,
  path: string,
  projectId?: string,
): Promise<KnowledgeFileDetail> {
  return apiClient.get<KnowledgeFileDetail>(
    `/api/knowledge/${scope}/${encodeURIComponent(targetId)}/file${buildQuery({ path, project_id: projectId })}`,
  );
}

/** 写入 / 覆盖 markdown 内容（仅 .md 文件） */
export function saveKnowledgeFile(
  scope: KnowledgeScope,
  targetId: string,
  path: string,
  content: string,
  projectId?: string,
): Promise<KnowledgeFileDetail> {
  return apiClient.put<KnowledgeFileDetail>(
    `/api/knowledge/${scope}/${encodeURIComponent(targetId)}/file${buildQuery({ path, project_id: projectId })}`,
    { content },
  );
}

/** 删除单个文件 */
export function deleteKnowledgeFile(
  scope: KnowledgeScope,
  targetId: string,
  path: string,
  projectId?: string,
): Promise<{ ok: boolean }> {
  return apiClient.del<{ ok: boolean }>(
    `/api/knowledge/${scope}/${encodeURIComponent(targetId)}/file${buildQuery({ path, project_id: projectId })}`,
  );
}

/** 触发异步生成任务，返回当前任务状态快照 */
export function triggerKnowledgeGenerate(
  scope: KnowledgeScope,
  targetId: string,
  graphType: KnowledgeGraphType = "all",
  agentId?: string,
): Promise<KnowledgeJob> {
  return apiClient.post<KnowledgeJob>(
    `/api/knowledge/${scope}/${encodeURIComponent(targetId)}/generate`,
    { graph_type: graphType, agent_id: agentId || undefined },
  );
}

/** 查询最近一次生成任务的状态 */
export function getKnowledgeStatus(
  scope: KnowledgeScope,
  targetId: string,
): Promise<KnowledgeJob> {
  return apiClient.get<KnowledgeJob>(
    `/api/knowledge/${scope}/${encodeURIComponent(targetId)}/status`,
  );
}

/** 导出知识图谱为 zip 文件并触发下载（携带认证 token） */
export async function downloadKnowledgeExport(
  scope: KnowledgeScope,
  targetId: string,
  projectId?: string,
): Promise<void> {
  let url = `${API_BASE_URL}/api/knowledge/${scope}/${encodeURIComponent(targetId)}/export`;
  if (projectId) {
    url += `?project_id=${encodeURIComponent(projectId)}`;
  }

  const headers = buildAuthHeaders();
  const response = await fetch(url, { method: "GET", headers });

  if (!response.ok) {
    let detail = "导出失败";
    try {
      const err = await response.json();
      if (err?.detail) detail = err.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  // 从 Content-Disposition 解析文件名，或使用默认名
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || `${targetId}-knowledge.zip`;

  // 创建临时链接触发下载
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 延迟释放 blob URL
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/** @deprecated 使用 downloadKnowledgeExport 代替（此方法不携带 token，认证开启时会 401） */
export function getKnowledgeExportUrl(
  scope: KnowledgeScope,
  targetId: string,
  projectId?: string,
): string {
  const base = `${API_BASE_URL}/api/knowledge/${scope}/${encodeURIComponent(targetId)}/export`;
  if (projectId) {
    return `${base}?project_id=${encodeURIComponent(projectId)}`;
  }
  return base;
}
