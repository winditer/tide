"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState, } from "react";
import { Button, Input, Select } from "@tide/ui";
import { fetchSessionsForProject, uploadTaskAttachments, useCreateTaskMutation, useProjects, } from "@tide/core";
const AGENT_OPTIONS = [
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude" },
    { label: "Qoder CLI", value: "qoder" },
];
const AGENT_LABEL = {
    codex: "CX",
    claude: "CC",
    qoder: "QO",
};
const AGENT_BADGE_CLASS = {
    codex: "bg-emerald-500/15 text-emerald-600",
    claude: "bg-amber-500/15 text-amber-600",
    qoder: "bg-sky-500/15 text-sky-600",
};
function formatSessionDate(value) {
    if (!value)
        return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        return value;
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return sameYear
        ? `${month}-${day} ${hh}:${mm}`
        : `${d.getFullYear()}-${month}-${day}`;
}
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 10;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function genId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function TaskCreateForm({ onSuccess }) {
    var _a, _b, _c, _d;
    const [prompt, setPrompt] = useState("");
    const [agentId, setAgentId] = useState("codex");
    const [model, setModel] = useState("");
    const [cwd, setCwd] = useState("");
    const [cwdOpen, setCwdOpen] = useState(false);
    const [sessionId, setSessionId] = useState("");
    const [sessionOpen, setSessionOpen] = useState(false);
    const [sessionList, setSessionList] = useState([]);
    const [sessionLoading, setSessionLoading] = useState(false);
    const [sessionError, setSessionError] = useState(null);
    const [attachments, setAttachments] = useState([]);
    const [dragActive, setDragActive] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const fileInputRef = useRef(null);
    const cwdBoxRef = useRef(null);
    const sessionBoxRef = useRef(null);
    const previewUrlsRef = useRef([]);
    const createMutation = useCreateTaskMutation();
    const projectsQuery = useProjects();
    const projects = (_b = (_a = projectsQuery.data) === null || _a === void 0 ? void 0 : _a.projects) !== null && _b !== void 0 ? _b : [];
    // 关闭 CWD 下拉（点击外部）
    useEffect(() => {
        if (!cwdOpen)
            return;
        const handler = (e) => {
            if (cwdBoxRef.current && !cwdBoxRef.current.contains(e.target)) {
                setCwdOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [cwdOpen]);
    // 关闭 Session 下拉（点击外部）
    useEffect(() => {
        if (!sessionOpen)
            return;
        const handler = (e) => {
            if (sessionBoxRef.current &&
                !sessionBoxRef.current.contains(e.target)) {
                setSessionOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [sessionOpen]);
    // cwd 变化时加载会话列表
    useEffect(() => {
        const target = cwd.trim();
        setSessionId("");
        setSessionError(null);
        if (!target) {
            setSessionList([]);
            setSessionLoading(false);
            return;
        }
        let cancelled = false;
        setSessionLoading(true);
        fetchSessionsForProject(target)
            .then((res) => {
            var _a;
            if (cancelled)
                return;
            setSessionList((_a = res.sessions) !== null && _a !== void 0 ? _a : []);
        })
            .catch((err) => {
            if (cancelled)
                return;
            setSessionList([]);
            setSessionError(err instanceof Error ? err.message : "加载会话失败");
        })
            .finally(() => {
            if (!cancelled)
                setSessionLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [cwd]);
    // 卸载时释放 ObjectURL
    useEffect(() => {
        const urls = previewUrlsRef.current;
        return () => {
            urls.forEach((u) => URL.revokeObjectURL(u));
        };
    }, []);
    const filteredProjects = useMemo(() => {
        const q = cwd.trim().toLowerCase();
        if (!q)
            return projects;
        return projects.filter((p) => p.name.toLowerCase().includes(q) ||
            p.cwd.toLowerCase().includes(q));
    }, [projects, cwd]);
    const groupedSessions = useMemo(() => {
        const project = [];
        const chat = [];
        for (const s of sessionList) {
            if (s.type === "chat")
                chat.push(s);
            else
                project.push(s);
        }
        return { project, chat };
    }, [sessionList]);
    const selectedSession = useMemo(() => { var _a; return (_a = sessionList.find((s) => s.id === sessionId)) !== null && _a !== void 0 ? _a : null; }, [sessionList, sessionId]);
    const sessionDisabled = !cwd.trim();
    const isUploading = attachments.some((a) => a.status === "uploading");
    const handleFiles = async (files) => {
        setUploadError(null);
        const incoming = Array.from(files);
        if (!incoming.length)
            return;
        const remaining = MAX_FILES - attachments.length;
        if (remaining <= 0) {
            setUploadError(`最多上传 ${MAX_FILES} 个文件`);
            return;
        }
        const accepted = [];
        for (const file of incoming.slice(0, remaining)) {
            if (file.size > MAX_FILE_SIZE) {
                setUploadError(`文件 ${file.name} 超过 20MB 上限`);
                continue;
            }
            accepted.push(file);
        }
        if (incoming.length > remaining) {
            setUploadError(`仅接受前 ${remaining} 个文件，最多 ${MAX_FILES} 个`);
        }
        if (!accepted.length)
            return;
        const items = accepted.map((file) => {
            const isImage = file.type.startsWith("image/") || IMAGE_RE.test(file.name);
            const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
            if (previewUrl)
                previewUrlsRef.current.push(previewUrl);
            return {
                id: genId(),
                name: file.name,
                size: file.size,
                isImage,
                previewUrl,
                status: "uploading",
            };
        });
        setAttachments((prev) => [...prev, ...items]);
        // 逐个上传，便于独立标记错误
        await Promise.all(accepted.map(async (file, idx) => {
            const item = items[idx];
            try {
                const res = await uploadTaskAttachments([file]);
                const remote = res.attachments[0];
                setAttachments((prev) => prev.map((a) => a.id === item.id
                    ? Object.assign(Object.assign({}, a), { status: "done", remotePath: remote }) : a));
            }
            catch (err) {
                setAttachments((prev) => prev.map((a) => a.id === item.id
                    ? Object.assign(Object.assign({}, a), { status: "error", error: err instanceof Error ? err.message : "上传失败" }) : a));
            }
        }));
    };
    const onPickFiles = (e) => {
        if (e.target.files) {
            handleFiles(e.target.files);
            e.target.value = "";
        }
    };
    const onDrop = (e) => {
        var _a;
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if ((_a = e.dataTransfer.files) === null || _a === void 0 ? void 0 : _a.length) {
            handleFiles(e.dataTransfer.files);
        }
    };
    const onDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
    };
    const onDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
    };
    const removeAttachment = (id) => {
        setAttachments((prev) => {
            const target = prev.find((a) => a.id === id);
            if (target === null || target === void 0 ? void 0 : target.previewUrl) {
                URL.revokeObjectURL(target.previewUrl);
                previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== target.previewUrl);
            }
            return prev.filter((a) => a.id !== id);
        });
    };
    const pickProject = (path) => {
        setCwd(path);
        setCwdOpen(false);
    };
    const pickSession = (id) => {
        setSessionId(id);
        setSessionOpen(false);
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!prompt.trim())
            return;
        if (isUploading)
            return;
        const remotePaths = attachments
            .filter((a) => a.status === "done" && a.remotePath)
            .map((a) => a.remotePath);
        try {
            await createMutation.mutateAsync({
                prompt: prompt.trim(),
                agent_id: agentId,
                model: model.trim() || undefined,
                cwd: cwd.trim() || undefined,
                session_id: sessionId || undefined,
                attachments: remotePaths,
            });
            // 清理预览 URL
            attachments.forEach((a) => {
                if (a.previewUrl)
                    URL.revokeObjectURL(a.previewUrl);
            });
            previewUrlsRef.current = [];
            setPrompt("");
            setModel("");
            setCwd("");
            setSessionId("");
            setAttachments([]);
            setUploadError(null);
            onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess();
        }
        catch (_a) {
            // mutation 状态会展示错误
        }
    };
    return (_jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "Prompt *" }), _jsx("textarea", { className: "flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", placeholder: "\u8F93\u5165\u4EFB\u52A1\u6307\u4EE4...", value: prompt, onChange: (e) => setPrompt(e.target.value), required: true })] }), _jsxs("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "Agent" }), _jsx(Select, { options: AGENT_OPTIONS, value: agentId, onChange: (e) => setAgentId(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u6A21\u578B" }), _jsx(Input, { placeholder: "\u53EF\u9009\uFF0C\u5982 o4-mini", value: model, onChange: (e) => setModel(e.target.value) })] })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u5DE5\u4F5C\u76EE\u5F55" }), _jsxs("div", { className: "relative", ref: cwdBoxRef, children: [_jsx(Input, { placeholder: "\u9009\u62E9\u9879\u76EE\u6216\u8F93\u5165\u8DEF\u5F84...", value: cwd, onChange: (e) => {
                                    setCwd(e.target.value);
                                    setCwdOpen(true);
                                }, onFocus: () => setCwdOpen(true), autoComplete: "off" }), cwdOpen && (filteredProjects.length > 0 || projectsQuery.isLoading) && (_jsxs("div", { className: "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-md", children: [projectsQuery.isLoading && (_jsx("div", { className: "px-2 py-2 text-xs text-muted-foreground", children: "\u52A0\u8F7D\u9879\u76EE\u4E2D..." })), filteredProjects.map((p) => (_jsxs("button", { type: "button", onClick: () => pickProject(p.cwd), className: "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground", children: [_jsx("span", { className: "font-medium", children: p.name }), _jsx("span", { className: "truncate text-xs text-muted-foreground", children: p.cwd })] }, p.id)))] }))] })] }), _jsxs("div", { children: [_jsxs("label", { className: "mb-1.5 block text-sm font-medium", children: ["\u4F1A\u8BDD", _jsx("span", { className: "ml-1 text-xs font-normal text-muted-foreground", children: "(\u53EF\u9009\uFF0C\u9ED8\u8BA4\u65B0\u5EFA\u4F1A\u8BDD)" })] }), _jsxs("div", { className: "relative", ref: sessionBoxRef, children: [_jsxs("button", { type: "button", disabled: sessionDisabled, onClick: () => !sessionDisabled && setSessionOpen((v) => !v), className: "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 " +
                                    (selectedSession ? "text-foreground" : "text-muted-foreground"), children: [selectedSession ? (_jsxs("span", { className: "flex min-w-0 items-center gap-2", children: [_jsx("span", { className: "inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold tracking-wide " +
                                                    ((_c = AGENT_BADGE_CLASS[selectedSession.agent_id]) !== null && _c !== void 0 ? _c : "bg-muted text-muted-foreground"), children: (_d = AGENT_LABEL[selectedSession.agent_id]) !== null && _d !== void 0 ? _d : selectedSession.agent_id.slice(0, 2).toUpperCase() }), _jsx("span", { className: "truncate", children: selectedSession.title || selectedSession.id }), _jsx("span", { className: "shrink-0 text-xs text-muted-foreground", children: formatSessionDate(selectedSession.created_at) })] })) : (_jsx("span", { children: sessionDisabled
                                            ? "请先选择工作目录"
                                            : sessionLoading
                                                ? "加载会话中..."
                                                : "新建会话（默认）/ 选择已有会话..." })), _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className: "ml-2 shrink-0 opacity-60", "aria-hidden": "true", children: _jsx("polyline", { points: "6 9 12 15 18 9" }) })] }), sessionOpen && !sessionDisabled && (_jsxs("div", { className: "absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-md", children: [_jsxs("button", { type: "button", onClick: () => pickSession(""), className: "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
                                            (sessionId === "" ? "bg-accent/60" : ""), children: [_jsx("span", { className: "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-dashed border-muted-foreground/60 text-[11px] text-muted-foreground", children: "+" }), _jsx("span", { className: "font-medium", children: "\u65B0\u5EFA\u4F1A\u8BDD" }), _jsx("span", { className: "ml-auto text-xs text-muted-foreground", children: "\u9ED8\u8BA4" })] }), sessionLoading && (_jsx("div", { className: "px-2 py-2 text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4F1A\u8BDD\u4E2D..." })), sessionError && !sessionLoading && (_jsx("div", { className: "px-2 py-2 text-xs text-destructive", children: sessionError })), !sessionLoading && !sessionError && groupedSessions.project.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", children: "Sessions \u00B7 \u9879\u76EE\u4F1A\u8BDD" }), groupedSessions.project.map((s) => (_jsx(SessionRow, { item: s, active: sessionId === s.id, onPick: pickSession }, `p-${s.id}`)))] })), !sessionLoading && !sessionError && groupedSessions.chat.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", children: "Chats \u00B7 \u666E\u901A\u5BF9\u8BDD" }), groupedSessions.chat.map((s) => (_jsx(SessionRow, { item: s, active: sessionId === s.id, onPick: pickSession }, `c-${s.id}`)))] })), !sessionLoading &&
                                        !sessionError &&
                                        groupedSessions.project.length === 0 &&
                                        groupedSessions.chat.length === 0 && (_jsx("div", { className: "px-2 py-3 text-center text-xs text-muted-foreground", children: "\u8BE5\u9879\u76EE\u4E0B\u6682\u65E0\u5386\u53F2\u4F1A\u8BDD" }))] }))] }), sessionError && !sessionOpen && (_jsx("p", { className: "mt-1.5 text-xs text-destructive", children: sessionError }))] }), _jsxs("div", { children: [_jsxs("label", { className: "mb-1.5 block text-sm font-medium", children: ["\u9644\u4EF6", _jsxs("span", { className: "ml-1 text-xs text-muted-foreground", children: ["(\u5355\u6587\u4EF6 \u2264 20MB\uFF0C\u6700\u591A ", MAX_FILES, " \u4E2A)"] })] }), _jsxs("div", { onDrop: onDrop, onDragOver: onDragOver, onDragEnter: onDragOver, onDragLeave: onDragLeave, onClick: () => { var _a; return (_a = fileInputRef.current) === null || _a === void 0 ? void 0 : _a.click(); }, role: "button", tabIndex: 0, onKeyDown: (e) => {
                            var _a;
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                (_a = fileInputRef.current) === null || _a === void 0 ? void 0 : _a.click();
                            }
                        }, className: "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors " +
                            (dragActive
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-input bg-background text-muted-foreground hover:border-primary/60 hover:bg-accent/30"), children: [_jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), _jsx("polyline", { points: "17 8 12 3 7 8" }), _jsx("line", { x1: "12", y1: "3", x2: "12", y2: "15" })] }), _jsxs("div", { children: [_jsx("span", { className: "font-medium text-foreground", children: "\u70B9\u51FB\u4E0A\u4F20" }), _jsx("span", { children: " \u6216\u62D6\u62FD\u6587\u4EF6\u5230\u6B64\u533A\u57DF" })] }), _jsx("input", { ref: fileInputRef, type: "file", multiple: true, className: "hidden", onChange: onPickFiles })] }), uploadError && (_jsx("p", { className: "mt-2 text-xs text-destructive", children: uploadError })), attachments.length > 0 && (_jsx("ul", { className: "mt-3 space-y-2", children: attachments.map((a) => (_jsxs("li", { className: "flex items-center gap-3 rounded-md border bg-background p-2", children: [_jsx("div", { className: "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted", children: a.isImage && a.previewUrl ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    _jsx("img", { src: a.previewUrl, alt: a.name, className: "h-full w-full object-cover" })) : (_jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), _jsx("polyline", { points: "14 2 14 8 20 8" })] })) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "truncate text-sm font-medium", children: a.name }), _jsxs("div", { className: "text-xs text-muted-foreground", children: [formatSize(a.size), a.status === "uploading" && (_jsx("span", { className: "ml-2 text-primary", children: "\u4E0A\u4F20\u4E2D..." })), a.status === "error" && (_jsx("span", { className: "ml-2 text-destructive", children: a.error || "上传失败" })), a.status === "done" && (_jsx("span", { className: "ml-2 text-emerald-600", children: "\u5DF2\u4E0A\u4F20" }))] })] }), _jsx("button", { type: "button", onClick: () => removeAttachment(a.id), "aria-label": `移除 ${a.name}`, className: "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", children: _jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] }) })] }, a.id))) }))] }), _jsx("div", { className: "flex justify-end gap-2", children: _jsx(Button, { type: "submit", disabled: createMutation.isPending || !prompt.trim() || isUploading, children: createMutation.isPending
                        ? "创建中..."
                        : isUploading
                            ? "等待上传完成..."
                            : "创建任务" }) }), createMutation.isError && (_jsxs("p", { className: "text-sm text-destructive", children: ["\u521B\u5EFA\u5931\u8D25\uFF1A", String(createMutation.error)] }))] }));
}
function SessionRow({ item, active, onPick }) {
    var _a, _b;
    const badgeClass = (_a = AGENT_BADGE_CLASS[item.agent_id]) !== null && _a !== void 0 ? _a : "bg-muted text-muted-foreground";
    const label = (_b = AGENT_LABEL[item.agent_id]) !== null && _b !== void 0 ? _b : item.agent_id.slice(0, 2).toUpperCase();
    return (_jsxs("button", { type: "button", onClick: () => onPick(item.id), title: item.title || item.id, className: "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
            (active ? "bg-accent/60" : ""), children: [_jsx("span", { className: "inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold tracking-wide " +
                    badgeClass, children: label }), _jsx("span", { className: "min-w-0 flex-1 truncate", children: item.title || (_jsx("span", { className: "text-muted-foreground", children: "(\u65E0\u6807\u9898)" })) }), _jsx("span", { className: "shrink-0 text-xs text-muted-foreground", children: formatSessionDate(item.created_at) })] }));
}
//# sourceMappingURL=TaskCreateForm.js.map