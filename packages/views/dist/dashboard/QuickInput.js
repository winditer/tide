"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Select } from "@tide/ui";
import { fetchSessionsForProject, useAgents, useCreateTaskMutation, useProjects, } from "@tide/core";
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
export function QuickInput() {
    var _a, _b, _c;
    const [prompt, setPrompt] = useState("");
    const [agentId, setAgentId] = useState("");
    const [cwd, setCwd] = useState("");
    const [sessionId, setSessionId] = useState("");
    const [projectOpen, setProjectOpen] = useState(false);
    const [sessionOpen, setSessionOpen] = useState(false);
    const [sessionList, setSessionList] = useState([]);
    const [sessionLoading, setSessionLoading] = useState(false);
    const [sessionError, setSessionError] = useState(null);
    const [defaultApplied, setDefaultApplied] = useState(false);
    const projectBoxRef = useRef(null);
    const sessionBoxRef = useRef(null);
    const { data: agentsData } = useAgents();
    const projectsQuery = useProjects();
    const createMutation = useCreateTaskMutation();
    const projects = (_b = (_a = projectsQuery.data) === null || _a === void 0 ? void 0 : _a.projects) !== null && _b !== void 0 ? _b : [];
    const agentOptions = [
        { label: "自动", value: "" },
        ...((_c = agentsData === null || agentsData === void 0 ? void 0 : agentsData.agents.map((a) => ({ label: a.name, value: a.id }))) !== null && _c !== void 0 ? _c : []),
    ];
    // 默认选中最近活跃项目
    useEffect(() => {
        var _a;
        if (defaultApplied)
            return;
        if (!projects.length)
            return;
        const sorted = [...projects].sort((a, b) => {
            const at = a.last_active ? new Date(a.last_active).getTime() : 0;
            const bt = b.last_active ? new Date(b.last_active).getTime() : 0;
            return bt - at;
        });
        const top = (_a = sorted.find((p) => p.status === "active")) !== null && _a !== void 0 ? _a : sorted[0];
        if (top)
            setCwd(top.cwd);
        setDefaultApplied(true);
    }, [projects, defaultApplied]);
    // 关闭项目下拉
    useEffect(() => {
        if (!projectOpen)
            return;
        const handler = (e) => {
            if (projectBoxRef.current &&
                !projectBoxRef.current.contains(e.target)) {
                setProjectOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [projectOpen]);
    // 关闭会话下拉
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
    // cwd 变化时重置并加载会话
    useEffect(() => {
        setSessionId("");
        setSessionError(null);
        if (!cwd) {
            setSessionList([]);
            setSessionLoading(false);
            return;
        }
        let cancelled = false;
        setSessionLoading(true);
        fetchSessionsForProject(cwd)
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
    const selectedProject = useMemo(() => { var _a; return (_a = projects.find((p) => p.cwd === cwd)) !== null && _a !== void 0 ? _a : null; }, [projects, cwd]);
    const selectedSession = useMemo(() => { var _a; return (_a = sessionList.find((s) => s.id === sessionId)) !== null && _a !== void 0 ? _a : null; }, [sessionList, sessionId]);
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
    function handleSubmit() {
        const trimmed = prompt.trim();
        if (!trimmed)
            return;
        createMutation.mutate({
            prompt: trimmed,
            agent_id: agentId || undefined,
            cwd: cwd || undefined,
            session_id: sessionId || undefined,
        }, {
            onSuccess: () => {
                setPrompt("");
                setSessionId("");
            },
        });
    }
    function handleKeyDown(e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
        }
    }
    function pickProject(path) {
        setCwd(path);
        setProjectOpen(false);
    }
    function clearProject() {
        setCwd("");
        setProjectOpen(false);
    }
    function pickSession(id) {
        setSessionId(id);
        setSessionOpen(false);
    }
    return (_jsxs("div", { className: "space-y-2 rounded-lg border bg-card p-3 shadow-sm", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs", children: [selectedProject ? (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary", children: [_jsx("span", { "aria-hidden": "true", className: "h-1.5 w-1.5 rounded-full bg-primary" }), "\u9879\u76EE\uFF1A", selectedProject.name] })) : (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground", children: [_jsx("span", { "aria-hidden": "true", className: "h-1.5 w-1.5 rounded-full bg-muted-foreground/60" }), "Chat \u6A21\u5F0F"] })), _jsxs("div", { className: "relative", ref: projectBoxRef, children: [_jsxs("button", { type: "button", onClick: () => setProjectOpen((v) => !v), className: "inline-flex h-6 items-center gap-1 rounded-full border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground", children: [_jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }) }), _jsx("span", { className: "max-w-[8rem] truncate", children: selectedProject ? selectedProject.name : "选择项目" }), _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", className: "opacity-60", children: _jsx("polyline", { points: "6 9 12 15 18 9" }) })] }), projectOpen && (_jsxs("div", { className: "absolute bottom-full left-0 z-50 mb-1 max-h-72 w-72 overflow-auto rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-md", children: [_jsxs("button", { type: "button", onClick: clearProject, className: "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
                                            (cwd === "" ? "bg-accent/60" : ""), children: [_jsx("span", { className: "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-dashed border-muted-foreground/60 text-[11px] text-muted-foreground", children: "\u2205" }), _jsx("span", { className: "font-medium", children: "\u4E0D\u9009\u9879\u76EE" }), _jsx("span", { className: "ml-auto text-xs text-muted-foreground", children: "Chat \u6A21\u5F0F" })] }), projectsQuery.isLoading && (_jsx("div", { className: "px-2 py-2 text-xs text-muted-foreground", children: "\u52A0\u8F7D\u9879\u76EE\u4E2D..." })), projects.length > 0 && (_jsx("div", { className: "mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", children: "\u9879\u76EE" })), projects.map((p) => (_jsxs("button", { type: "button", onClick: () => pickProject(p.cwd), className: "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
                                            (cwd === p.cwd ? "bg-accent/60" : ""), children: [_jsxs("span", { className: "flex w-full items-center gap-2", children: [_jsx("span", { className: "truncate font-medium", children: p.name }), p.status === "active" && (_jsx("span", { className: "ml-auto inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" }))] }), _jsx("span", { className: "w-full truncate text-xs text-muted-foreground", children: p.cwd })] }, p.id))), !projectsQuery.isLoading && projects.length === 0 && (_jsx("div", { className: "px-2 py-3 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u9879\u76EE" }))] }))] }), selectedProject && (_jsxs("div", { className: "relative", ref: sessionBoxRef, children: [_jsxs("button", { type: "button", onClick: () => setSessionOpen((v) => !v), className: "inline-flex h-6 items-center gap-1 rounded-full border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground", children: [_jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }) }), _jsx("span", { className: "max-w-[10rem] truncate", children: selectedSession
                                            ? selectedSession.title || selectedSession.id
                                            : "新建会话" }), _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", className: "opacity-60", children: _jsx("polyline", { points: "6 9 12 15 18 9" }) })] }), sessionOpen && (_jsxs("div", { className: "absolute bottom-full left-0 z-50 mb-1 max-h-72 w-80 overflow-auto rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-md", children: [_jsxs("button", { type: "button", onClick: () => pickSession(""), className: "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
                                            (sessionId === "" ? "bg-accent/60" : ""), children: [_jsx("span", { className: "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-dashed border-muted-foreground/60 text-[11px] text-muted-foreground", children: "+" }), _jsx("span", { className: "font-medium", children: "\u65B0\u5EFA\u4F1A\u8BDD" }), _jsx("span", { className: "ml-auto text-xs text-muted-foreground", children: "\u9ED8\u8BA4" })] }), sessionLoading && (_jsx("div", { className: "px-2 py-2 text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4F1A\u8BDD\u4E2D..." })), sessionError && !sessionLoading && (_jsx("div", { className: "px-2 py-2 text-xs text-destructive", children: sessionError })), !sessionLoading && !sessionError && groupedSessions.project.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", children: "Sessions \u00B7 \u9879\u76EE\u4F1A\u8BDD" }), groupedSessions.project.map((s) => (_jsx(SessionRow, { item: s, active: sessionId === s.id, onPick: pickSession }, `p-${s.id}`)))] })), !sessionLoading && !sessionError && groupedSessions.chat.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", children: "Chats \u00B7 \u666E\u901A\u5BF9\u8BDD" }), groupedSessions.chat.map((s) => (_jsx(SessionRow, { item: s, active: sessionId === s.id, onPick: pickSession }, `c-${s.id}`)))] })), !sessionLoading &&
                                        !sessionError &&
                                        groupedSessions.project.length === 0 &&
                                        groupedSessions.chat.length === 0 && (_jsx("div", { className: "px-2 py-3 text-center text-xs text-muted-foreground", children: "\u8BE5\u9879\u76EE\u4E0B\u6682\u65E0\u5386\u53F2\u4F1A\u8BDD" }))] }))] }))] }), _jsxs("div", { className: "flex items-end gap-3", children: [_jsx("textarea", { className: "flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", rows: 2, placeholder: selectedProject
                            ? `在「${selectedProject.name}」中执行... (Ctrl+Enter 提交)`
                            : "输入指令进行普通对话... (Ctrl+Enter 提交)", value: prompt, onChange: (e) => setPrompt(e.target.value), onKeyDown: handleKeyDown }), _jsx("div", { className: "w-28 shrink-0", children: _jsx(Select, { options: agentOptions, value: agentId, onChange: (e) => setAgentId(e.target.value) }) }), _jsx(Button, { onClick: handleSubmit, disabled: !prompt.trim() || createMutation.isPending, children: createMutation.isPending ? "提交中..." : "执行" })] })] }));
}
function SessionRow({ item, active, onPick }) {
    var _a, _b;
    const badgeClass = (_a = AGENT_BADGE_CLASS[item.agent_id]) !== null && _a !== void 0 ? _a : "bg-muted text-muted-foreground";
    const label = (_b = AGENT_LABEL[item.agent_id]) !== null && _b !== void 0 ? _b : item.agent_id.slice(0, 2).toUpperCase();
    return (_jsxs("button", { type: "button", onClick: () => onPick(item.id), title: item.title || item.id, className: "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground " +
            (active ? "bg-accent/60" : ""), children: [_jsx("span", { className: "inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold tracking-wide " +
                    badgeClass, children: label }), _jsx("span", { className: "min-w-0 flex-1 truncate", children: item.title || (_jsx("span", { className: "text-muted-foreground", children: "(\u65E0\u6807\u9898)" })) }), _jsx("span", { className: "shrink-0 text-xs text-muted-foreground", children: formatSessionDate(item.created_at) })] }));
}
//# sourceMappingURL=QuickInput.js.map