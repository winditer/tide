"use client";
import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, toast, } from "@tide/ui";
import { useDeleteKnowledgeFile, useKnowledgeFile, useKnowledgeFiles, useKnowledgeStatus, useSaveKnowledgeFile, useTriggerKnowledgeGenerate, downloadKnowledgeExport, } from "@tide/core";
import { SimpleMarkdown } from "../shared/SimpleMarkdown";
const GRAPH_TYPE_OPTIONS = [
    { value: "all", label: "全部图谱" },
    { value: "module", label: "模块依赖" },
    { value: "api", label: "API 接口" },
    { value: "db", label: "数据库 Schema" },
    { value: "concept", label: "业务概念" },
];
const STATUS_LABEL = {
    idle: "未生成",
    pending: "排队中",
    running: "生成中",
    completed: "已生成",
    failed: "失败",
};
const STATUS_VARIANT = {
    idle: "outline",
    pending: "secondary",
    running: "default",
    completed: "success",
    failed: "destructive",
};
function fmtBytes(n) {
    if (!Number.isFinite(n) || n <= 0)
        return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
function fmtTime(iso) {
    if (!iso)
        return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    catch (_a) {
        return iso;
    }
}
function getApiErrorMessage(err) {
    var _a;
    const e = err;
    if ((e === null || e === void 0 ? void 0 : e.body) && typeof e.body === "object") {
        const detail = e.body.detail;
        if (typeof detail === "string")
            return detail;
    }
    return (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : String(err);
}
/** 把扁平文件列表按一级目录分组，方便树状渲染 */
function groupByTopDir(files) {
    var _a;
    const map = new Map();
    for (const f of files) {
        const idx = f.path.indexOf("/");
        const dir = idx >= 0 ? f.path.slice(0, idx) : "/";
        const arr = (_a = map.get(dir)) !== null && _a !== void 0 ? _a : [];
        arr.push(f);
        map.set(dir, arr);
    }
    return Array.from(map.entries())
        .sort(([a], [b]) => {
        if (a === "/")
            return -1;
        if (b === "/")
            return 1;
        return a.localeCompare(b);
    })
        .map(([dir, items]) => ({
        dir,
        items: items.sort((a, b) => a.path.localeCompare(b.path)),
    }));
}
/**
 * 知识图谱卡片：嵌入到项目 / 项目组的设置 Tab 中。
 *
 * 功能：
 * - 查看 `.knowledge/` 下所有 Markdown / JSON 文件；
 * - 选择文件后右侧显示内容（.md 可切换到编辑模式后保存）；
 * - 支持删除单个文件；
 * - "立即生成" 按异步任务执行后端脚本，自动轮询进度。
 */
export function KnowledgeGraphCard({ scope, targetId }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const filesQuery = useKnowledgeFiles(scope, targetId);
    const statusQuery = useKnowledgeStatus(scope, targetId);
    const triggerMutation = useTriggerKnowledgeGenerate();
    const saveMutation = useSaveKnowledgeFile();
    const deleteMutation = useDeleteKnowledgeFile();
    const repos = (_b = (_a = filesQuery.data) === null || _a === void 0 ? void 0 : _a.repos) !== null && _b !== void 0 ? _b : [];
    // group 多仓库时需要选择当前查看的仓库
    const [activeProjectId, setActiveProjectId] = useState(undefined);
    useEffect(() => {
        if (!activeProjectId && repos.length > 0) {
            setActiveProjectId(repos[0].project_id);
        }
        if (activeProjectId &&
            repos.length > 0 &&
            !repos.some((r) => r.project_id === activeProjectId)) {
            setActiveProjectId(repos[0].project_id);
        }
    }, [activeProjectId, repos]);
    const activeRepo = useMemo(() => { var _a; return (_a = repos.find((r) => r.project_id === activeProjectId)) !== null && _a !== void 0 ? _a : repos[0]; }, [repos, activeProjectId]);
    // 选中文件
    const [selectedPath, setSelectedPath] = useState(undefined);
    useEffect(() => {
        var _a, _b;
        if (!activeRepo) {
            setSelectedPath(undefined);
            return;
        }
        const mdFile = (_b = (_a = activeRepo.files.find((f) => f.path === "_index.md")) !== null && _a !== void 0 ? _a : activeRepo.files.find((f) => f.ext === "md")) !== null && _b !== void 0 ? _b : activeRepo.files[0];
        setSelectedPath(mdFile === null || mdFile === void 0 ? void 0 : mdFile.path);
    }, [activeRepo === null || activeRepo === void 0 ? void 0 : activeRepo.project_id]); // eslint-disable-line react-hooks/exhaustive-deps
    const fileQuery = useKnowledgeFile(scope, targetId, selectedPath, scope === "group" ? activeRepo === null || activeRepo === void 0 ? void 0 : activeRepo.project_id : undefined);
    // 生成参数
    const [graphType, setGraphType] = useState("all");
    // 编辑模式
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    useEffect(() => {
        var _a, _b;
        setEditing(false);
        setDraft((_b = (_a = fileQuery.data) === null || _a === void 0 ? void 0 : _a.content) !== null && _b !== void 0 ? _b : "");
    }, [(_c = fileQuery.data) === null || _c === void 0 ? void 0 : _c.path, (_d = fileQuery.data) === null || _d === void 0 ? void 0 : _d.content]);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const jobStatus = (_f = (_e = statusQuery.data) === null || _e === void 0 ? void 0 : _e.status) !== null && _f !== void 0 ? _f : "idle";
    const isRunning = jobStatus === "pending" || jobStatus === "running";
    const progress = (_g = statusQuery.data) === null || _g === void 0 ? void 0 : _g.progress;
    // 如果文件存在但任务状态为 idle（服务重启后），显示“已生成”
    const hasFiles = repos.some((r) => r.files.length > 0);
    const displayStatus = jobStatus === "idle" && hasFiles ? "completed" : jobStatus;
    const isMd = (selectedPath !== null && selectedPath !== void 0 ? selectedPath : "").toLowerCase().endsWith(".md");
    const handleTrigger = async () => {
        try {
            await triggerMutation.mutateAsync({ scope, targetId, graphType });
            toast({ title: "已开始生成", description: "可在卡片顶部查看进度" });
            statusQuery.refetch();
        }
        catch (err) {
            toast({
                title: "触发失败",
                description: getApiErrorMessage(err),
                variant: "destructive",
            });
        }
    };
    // 任务完成后刷新文件列表
    useEffect(() => {
        if (jobStatus === "completed") {
            filesQuery.refetch();
        }
    }, [jobStatus]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleSave = async () => {
        if (!selectedPath || !isMd)
            return;
        try {
            await saveMutation.mutateAsync({
                scope,
                targetId,
                path: selectedPath,
                content: draft,
                projectId: scope === "group" ? activeRepo === null || activeRepo === void 0 ? void 0 : activeRepo.project_id : undefined,
            });
            toast({ title: "已保存" });
            setEditing(false);
        }
        catch (err) {
            toast({
                title: "保存失败",
                description: getApiErrorMessage(err),
                variant: "destructive",
            });
        }
    };
    const handleDelete = async () => {
        if (!selectedPath)
            return;
        try {
            await deleteMutation.mutateAsync({
                scope,
                targetId,
                path: selectedPath,
                projectId: scope === "group" ? activeRepo === null || activeRepo === void 0 ? void 0 : activeRepo.project_id : undefined,
            });
            toast({ title: "已删除" });
            setConfirmDelete(false);
            setSelectedPath(undefined);
        }
        catch (err) {
            toast({
                title: "删除失败",
                description: getApiErrorMessage(err),
                variant: "destructive",
            });
        }
    };
    const totalFiles = repos.reduce((acc, r) => acc + r.files.length, 0);
    return (_jsxs("div", { className: "bg-card rounded-xl shadow-card p-6 space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsxs("h2", { className: "text-base font-medium", children: ["\u77E5\u8BC6\u56FE\u8C31", (activeRepo === null || activeRepo === void 0 ? void 0 : activeRepo.meta) && (_jsxs("span", { className: "ml-2 text-xs font-normal text-muted-foreground", children: ["v", (_h = activeRepo.meta.version) !== null && _h !== void 0 ? _h : 1] }))] }), _jsxs("p", { className: "mt-0.5 text-xs text-muted-foreground", children: ["\u4ED3\u5E93\u4E0B ", _jsx("code", { className: "font-mono", children: ".knowledge/" }), " ", "\u76EE\u5F55\u4E2D\u7684 Markdown / JSON \u4EA7\u7269\uFF08\u6A21\u5757\u4F9D\u8D56\u3001API\u3001\u6570\u636E\u5E93 Schema\u3001\u4E1A\u52A1\u6982\u5FF5\uFF09"] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Badge, { variant: STATUS_VARIANT[displayStatus], children: STATUS_LABEL[displayStatus] }), isRunning && progress && (_jsxs("span", { className: "font-mono text-xs text-muted-foreground", children: [progress.done, "/", progress.total, progress.current ? ` · ${progress.current}` : ""] }))] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-3", children: [_jsx("span", { className: "text-xs text-muted-foreground", children: "\u751F\u6210\u7C7B\u578B\uFF1A" }), _jsx(Select, { value: graphType, onChange: (e) => setGraphType(e.target.value), options: GRAPH_TYPE_OPTIONS, className: "w-40", disabled: isRunning }), _jsx(Button, { onClick: handleTrigger, disabled: isRunning || triggerMutation.isPending, children: isRunning
                            ? "生成中…"
                            : triggerMutation.isPending
                                ? "提交中…"
                                : "立即生成" }), totalFiles > 0 && (_jsx(Button, { variant: "outline", onClick: async () => {
                            try {
                                await downloadKnowledgeExport(scope, targetId, scope === "group" ? activeRepo === null || activeRepo === void 0 ? void 0 : activeRepo.project_id : undefined);
                            }
                            catch (err) {
                                toast({
                                    title: "导出失败",
                                    description: err instanceof Error ? err.message : String(err),
                                    variant: "destructive",
                                });
                            }
                        }, children: "\u5BFC\u51FA" })), _jsxs("span", { className: "ml-auto text-xs text-muted-foreground", children: ["\u6700\u8FD1\uFF1A", fmtTime((_k = (_j = statusQuery.data) === null || _j === void 0 ? void 0 : _j.finished_at) !== null && _k !== void 0 ? _k : (_l = statusQuery.data) === null || _l === void 0 ? void 0 : _l.started_at)] })] }), ((_m = statusQuery.data) === null || _m === void 0 ? void 0 : _m.status) === "failed" && statusQuery.data.error && (_jsxs("div", { className: "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive", children: ["\u4E0A\u6B21\u5931\u8D25\uFF1A", statusQuery.data.error] })), scope === "group" && repos.length > 1 && (_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "text-xs text-muted-foreground", children: "\u4ED3\u5E93\uFF1A" }), repos.map((r) => (_jsxs("button", { type: "button", onClick: () => setActiveProjectId(r.project_id), className: `rounded-md border px-2.5 py-1 text-xs transition-smooth ${(activeRepo === null || activeRepo === void 0 ? void 0 : activeRepo.project_id) === r.project_id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground hover:border-primary/50"}`, children: [r.name, _jsx("span", { className: "ml-1.5 font-mono text-[10px] text-muted-foreground/70", children: r.files.length })] }, r.project_id)))] })), filesQuery.isLoading ? (_jsx("p", { className: "text-sm text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" })) : totalFiles === 0 ? (_jsx("p", { className: "text-sm text-muted-foreground", children: "\u6682\u65E0\u77E5\u8BC6\u56FE\u8C31\u4EA7\u7269\u3002\u70B9\u51FB \u201C\u7ACB\u5373\u751F\u6210\u201D \u521B\u5EFA\u7B2C\u4E00\u4EFD\u56FE\u8C31\u3002" })) : (_jsxs("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]", children: [_jsx("div", { className: "max-h-[480px] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-sm", children: (activeRepo === null || activeRepo === void 0 ? void 0 : activeRepo.files.length) ? (groupByTopDir(activeRepo.files).map((group) => (_jsxs("div", { className: "border-b border-zinc-100 last:border-b-0", children: [_jsx("div", { className: "bg-zinc-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500", children: group.dir === "/" ? "root" : group.dir }), _jsx("ul", { children: group.items.map((f) => {
                                        const active = selectedPath === f.path;
                                        return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setSelectedPath(f.path), className: `flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${active
                                                    ? "bg-blue-50 text-blue-700 border-l-2 border-blue-500"
                                                    : "hover:bg-zinc-50 text-zinc-600 border-l-2 border-transparent"}`, children: [_jsx("span", { className: "truncate font-mono text-[12px]", children: f.path.includes("/")
                                                            ? f.path.slice(f.path.indexOf("/") + 1)
                                                            : f.path }), _jsx("span", { className: "shrink-0 font-mono text-[10px] text-zinc-400", children: fmtBytes(f.size) })] }) }, f.path));
                                    }) })] }, group.dir)))) : (_jsx("p", { className: "p-3 text-sm text-zinc-400 italic", children: "\u8BE5\u4ED3\u5E93\u6682\u65E0\u4EA7\u7269" })) }), _jsxs("div", { className: "flex min-h-[320px] flex-col rounded-lg border border-zinc-200 bg-white shadow-sm", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 bg-zinc-50/50", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [selectedPath ? (_jsx("div", { className: "truncate font-mono text-[12px] text-zinc-700", children: selectedPath })) : (_jsx("span", { className: "text-sm text-zinc-400 italic", children: "\u672A\u9009\u62E9\u6587\u4EF6" })), ((_o = fileQuery.data) === null || _o === void 0 ? void 0 : _o.modified_at) && (_jsxs("div", { className: "mt-0.5 text-[10px] text-zinc-400", children: ["\u66F4\u65B0\u4E8E ", fmtTime(fileQuery.data.modified_at), " \u00B7", " ", fmtBytes((_p = fileQuery.data.size) !== null && _p !== void 0 ? _p : 0)] }))] }), _jsxs("div", { className: "flex items-center gap-2", children: [isMd && selectedPath && !editing && (_jsx(Button, { variant: "outline", onClick: () => {
                                                    var _a, _b;
                                                    setDraft((_b = (_a = fileQuery.data) === null || _a === void 0 ? void 0 : _a.content) !== null && _b !== void 0 ? _b : "");
                                                    setEditing(true);
                                                }, children: "\u7F16\u8F91" })), editing && (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", onClick: () => {
                                                            var _a, _b;
                                                            setEditing(false);
                                                            setDraft((_b = (_a = fileQuery.data) === null || _a === void 0 ? void 0 : _a.content) !== null && _b !== void 0 ? _b : "");
                                                        }, children: "\u53D6\u6D88" }), _jsx(Button, { onClick: handleSave, disabled: saveMutation.isPending, children: saveMutation.isPending ? "保存中…" : "保存" })] })), selectedPath && !editing && (_jsx(Button, { variant: "destructive", onClick: () => setConfirmDelete(true), children: "\u5220\u9664" }))] })] }), _jsx("div", { className: "flex-1 min-w-0 overflow-auto p-4 bg-white/60", children: fileQuery.isLoading ? (_jsx("p", { className: "text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" })) : fileQuery.isError ? (_jsxs("p", { className: "text-xs text-destructive", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", getApiErrorMessage(fileQuery.error)] })) : editing && isMd ? (_jsx("textarea", { value: draft, onChange: (e) => setDraft(e.target.value), spellCheck: false, className: "h-[400px] w-full resize-y rounded-md border border-border/60 bg-background p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring" })) : fileQuery.data ? (isMd ? (_jsx("div", { className: "overflow-x-auto break-words", onClick: (e) => {
                                        const target = e.target;
                                        const anchor = target.closest("a");
                                        if (!anchor)
                                            return;
                                        const href = anchor.getAttribute("href") || "";
                                        // 仅拦截相对路径链接（非外部 URL）
                                        if (href.includes("://") || href.startsWith("#"))
                                            return;
                                        e.preventDefault();
                                        // 解析相对路径：基于当前文件所在目录
                                        const currentDir = (selectedPath === null || selectedPath === void 0 ? void 0 : selectedPath.includes("/"))
                                            ? selectedPath.slice(0, selectedPath.lastIndexOf("/"))
                                            : "";
                                        const cleanHref = href.replace(/^\.\//, "");
                                        const parts = (currentDir ? `${currentDir}/${cleanHref}` : cleanHref).split("/");
                                        // 规范化路径（处理 ../ 和 ./）
                                        const resolved = [];
                                        for (const p of parts) {
                                            if (p === "" || p === ".")
                                                continue;
                                            if (p === "..") {
                                                resolved.pop();
                                                continue;
                                            }
                                            resolved.push(p);
                                        }
                                        setSelectedPath(resolved.join("/"));
                                    }, children: _jsx(SimpleMarkdown, { source: fileQuery.data.content, variant: "compact", className: "max-w-none" }) })) : (_jsx("pre", { className: "overflow-x-auto rounded-lg bg-zinc-800 p-3.5 font-mono text-[13px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words", children: fileQuery.data.content }))) : (_jsx("p", { className: "text-sm text-zinc-400 italic", children: "\u4ECE\u5DE6\u4FA7\u5217\u8868\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6" })) })] })] })), _jsx(Dialog, { open: confirmDelete, onOpenChange: setConfirmDelete, children: _jsxs(DialogContent, { className: "max-w-md", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "\u5220\u9664\u6587\u4EF6" }), _jsxs(DialogDescription, { children: ["\u786E\u5B9A\u8981\u5220\u9664 ", _jsx("code", { className: "font-mono", children: selectedPath }), " \u5417\uFF1F \u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\uFF08\u6587\u4EF6\u4F1A\u4ECE\u4ED3\u5E93 .knowledge/ \u76EE\u5F55\u4E2D\u79FB\u9664\uFF09\u3002"] })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: () => setConfirmDelete(false), disabled: deleteMutation.isPending, children: "\u53D6\u6D88" }), _jsx(Button, { variant: "destructive", onClick: handleDelete, disabled: deleteMutation.isPending, children: deleteMutation.isPending ? "删除中…" : "确认删除" })] })] }) })] }));
}
//# sourceMappingURL=KnowledgeGraphCard.js.map