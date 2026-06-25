import { apiClient, API_BASE_URL, buildAuthHeaders } from "./client";
function buildQuery(params) {
    if (!params)
        return "";
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "")
            search.set(k, v);
    }
    const qs = search.toString();
    return qs ? `?${qs}` : "";
}
/** 列出 .knowledge/ 下文件（group scope 未指定 project_id 时返回聚合视图） */
export function listKnowledgeFiles(scope, targetId, projectId) {
    return apiClient.get(`/api/knowledge/${scope}/${encodeURIComponent(targetId)}/files${buildQuery({ project_id: projectId })}`);
}
/** 读取单个 markdown / json 文件内容 */
export function getKnowledgeFile(scope, targetId, path, projectId) {
    return apiClient.get(`/api/knowledge/${scope}/${encodeURIComponent(targetId)}/file${buildQuery({ path, project_id: projectId })}`);
}
/** 写入 / 覆盖 markdown 内容（仅 .md 文件） */
export function saveKnowledgeFile(scope, targetId, path, content, projectId) {
    return apiClient.put(`/api/knowledge/${scope}/${encodeURIComponent(targetId)}/file${buildQuery({ path, project_id: projectId })}`, { content });
}
/** 删除单个文件 */
export function deleteKnowledgeFile(scope, targetId, path, projectId) {
    return apiClient.del(`/api/knowledge/${scope}/${encodeURIComponent(targetId)}/file${buildQuery({ path, project_id: projectId })}`);
}
/** 触发异步生成任务，返回当前任务状态快照 */
export function triggerKnowledgeGenerate(scope, targetId, graphType = "all") {
    return apiClient.post(`/api/knowledge/${scope}/${encodeURIComponent(targetId)}/generate`, { graph_type: graphType });
}
/** 查询最近一次生成任务的状态 */
export function getKnowledgeStatus(scope, targetId) {
    return apiClient.get(`/api/knowledge/${scope}/${encodeURIComponent(targetId)}/status`);
}
/** 导出知识图谱为 zip 文件并触发下载（携带认证 token） */
export async function downloadKnowledgeExport(scope, targetId, projectId) {
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
            if (err === null || err === void 0 ? void 0 : err.detail)
                detail = err.detail;
        }
        catch (_a) {
            // ignore
        }
        throw new Error(detail);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    // 从 Content-Disposition 解析文件名，或使用默认名
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = (match === null || match === void 0 ? void 0 : match[1]) || `${targetId}-knowledge.zip`;
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
export function getKnowledgeExportUrl(scope, targetId, projectId) {
    const base = `${API_BASE_URL}/api/knowledge/${scope}/${encodeURIComponent(targetId)}/export`;
    if (projectId) {
        return `${base}?project_id=${encodeURIComponent(projectId)}`;
    }
    return base;
}
//# sourceMappingURL=knowledge.js.map