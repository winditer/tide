"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select, } from "@tide/ui";
import { useCreatePlan, useProjects, useProjectGroups, useProjectGroup, } from "@tide/core";
const AGENT_OPTIONS = [
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude" },
    { label: "Qoder CLI", value: "qoder" },
];
const MODEL_PRESETS = [
    { label: "默认（不指定）", value: "" },
    { label: "o4-mini", value: "o4-mini" },
    { label: "gpt-5", value: "gpt-5" },
    { label: "claude-sonnet-4.5", value: "claude-sonnet-4.5" },
    { label: "claude-opus-4", value: "claude-opus-4" },
];
const SCOPE_PROJECT_PREFIX = "project:";
const SCOPE_GROUP_PREFIX = "group:";
const emptyRow = () => ({
    title: "",
    prompt: "",
    agent_id: "codex",
    depends_on: "",
    phase: "0",
    cwd: "",
});
export function PlanCreateForm({ onSuccess, initialScopeValue, }) {
    var _a;
    const [rows, setRows] = useState([emptyRow()]);
    const [model, setModel] = useState("");
    const [modelPreset, setModelPreset] = useState("");
    const [maxParallel, setMaxParallel] = useState("3");
    /**
     * 工作区归属：
     * - "project:<id>" → 单仓库 Plan，cwd = 该项目 cwd
     * - "group:<id>"   → 项目组工作区，group_id=<id>，默认 cwd 由后端解析为 primary
     */
    const [scopeValue, setScopeValue] = useState(initialScopeValue !== null && initialScopeValue !== void 0 ? initialScopeValue : "");
    const create = useCreatePlan();
    const { data: projectsData } = useProjects();
    const { data: groupsData } = useProjectGroups();
    const projects = useMemo(() => { var _a; return (_a = projectsData === null || projectsData === void 0 ? void 0 : projectsData.projects) !== null && _a !== void 0 ? _a : []; }, [projectsData]);
    const groups = useMemo(() => { var _a; return (_a = groupsData === null || groupsData === void 0 ? void 0 : groupsData.groups) !== null && _a !== void 0 ? _a : []; }, [groupsData]);
    const selectedProjectId = scopeValue.startsWith(SCOPE_PROJECT_PREFIX)
        ? scopeValue.slice(SCOPE_PROJECT_PREFIX.length)
        : undefined;
    const selectedGroupId = scopeValue.startsWith(SCOPE_GROUP_PREFIX)
        ? scopeValue.slice(SCOPE_GROUP_PREFIX.length)
        : undefined;
    const { data: groupDetail } = useProjectGroup(selectedGroupId);
    const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId), [projects, selectedProjectId]);
    const groupPrimary = useMemo(() => {
        var _a;
        if (!groupDetail)
            return undefined;
        return ((_a = groupDetail.members.find((m) => m.role === "primary")) !== null && _a !== void 0 ? _a : groupDetail.members[0]);
    }, [groupDetail]);
    const scopeGroupsOptions = useMemo(() => {
        const out = [];
        if (projects.length > 0) {
            out.push({
                label: "项目",
                options: projects.map((p) => ({
                    value: `${SCOPE_PROJECT_PREFIX}${p.id}`,
                    label: p.name === p.cwd ? p.cwd : `${p.name}  ·  ${p.cwd}`,
                })),
            });
        }
        if (groups.length > 0) {
            out.push({
                label: "项目组",
                options: groups.map((g) => ({
                    value: `${SCOPE_GROUP_PREFIX}${g.id}`,
                    label: `${g.name} (${g.member_count})`,
                })),
            });
        }
        return out;
    }, [projects, groups]);
    const scopeFlatOptions = useMemo(() => [{ value: "", label: "请选择项目或项目组…" }], []);
    const updateRow = (idx, patch) => {
        setRows((prev) => prev.map((r, i) => (i === idx ? Object.assign(Object.assign({}, r), patch) : r)));
    };
    const removeRow = (idx) => setRows((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));
    const addRow = () => setRows((prev) => [...prev, emptyRow()]);
    const buildTasks = () => {
        return rows
            .filter((r) => r.title.trim() && r.prompt.trim())
            .map((r) => {
            const cwdOverride = r.cwd.trim();
            return Object.assign({ title: r.title.trim(), prompt: r.prompt.trim(), agent_id: r.agent_id || "codex", phase: Number(r.phase) || 0, depends_on: r.depends_on
                    .split(/[ ,]+/)
                    .filter((s) => s.length > 0)
                    .map((s) => Number(s))
                    .filter((n) => Number.isFinite(n) && n >= 0) }, (cwdOverride ? { cwd: cwdOverride } : {}));
        });
    };
    // 项目组下子任务 cwd 候选：用于选择目标仓库
    const groupMemberCwds = useMemo(() => {
        if (!groupDetail)
            return [];
        return groupDetail.members
            .filter((m) => !!m.cwd)
            .map((m) => ({ value: m.cwd, label: `${m.name} (${m.role})` }));
    }, [groupDetail]);
    // 切换归属时清空已填的子任务 cwd 覆盖（避免跨项目残留）
    useEffect(() => {
        setRows((prev) => prev.map((r) => (Object.assign(Object.assign({}, r), { cwd: "" }))));
    }, [scopeValue]);
    const handleSubmit = async (e) => {
        e.preventDefault();
        const tasks = buildTasks();
        if (tasks.length === 0)
            return;
        if (!selectedProjectId && !selectedGroupId)
            return;
        const params = {
            definition: { tasks, max_parallel: Number(maxParallel) || 3 },
            model: model.trim() || undefined,
        };
        if (selectedGroupId) {
            params.group_id = selectedGroupId;
            // cwd 不传：后端会自动取 group primary 的路径
        }
        else if (selectedProject) {
            params.cwd = selectedProject.cwd || undefined;
        }
        try {
            const plan = await create.mutateAsync(params);
            onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess(plan.id);
        }
        catch (_a) {
            // surfaced via mutation state
        }
    };
    const submitDisabled = create.isPending ||
        (!selectedProjectId && !selectedGroupId) ||
        (!!selectedGroupId && !groupPrimary);
    return (_jsxs("form", { onSubmit: handleSubmit, className: "space-y-5", children: [_jsxs("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-3", children: [_jsxs("div", { children: [_jsx(Label, { children: "\u5DE5\u4F5C\u533A" }), _jsx(Select, { options: scopeFlatOptions, groups: scopeGroupsOptions, value: scopeValue, onChange: (e) => setScopeValue(e.target.value), className: "rounded-lg", "aria-label": "\u9009\u62E9\u9879\u76EE\u6216\u9879\u76EE\u7EC4" }), selectedGroupId && groupDetail && (_jsxs("p", { className: "mt-1.5 text-[11px] text-muted-foreground", children: ["\u9879\u76EE\u7EC4 \u00B7", " ", _jsx("span", { className: "font-mono text-foreground", children: (_a = groupPrimary === null || groupPrimary === void 0 ? void 0 : groupPrimary.name) !== null && _a !== void 0 ? _a : "—" }), " ", "\u5C06\u4F5C\u4E3A\u9ED8\u8BA4 cwd\uFF1B\u5B50\u4EFB\u52A1\u53EF\u5728\u4E0B\u65B9\u5355\u72EC\u8986\u76D6\u76EE\u6807\u4ED3\u5E93\u3002"] })), selectedProject && (_jsx("p", { className: "mt-1.5 truncate font-mono text-[11px] text-muted-foreground", children: selectedProject.cwd }))] }), _jsxs("div", { children: [_jsx(Label, { children: "\u6A21\u578B" }), _jsxs("div", { className: "space-y-1", children: [_jsx(Select, { options: MODEL_PRESETS, value: modelPreset, onChange: (e) => {
                                            const v = e.target.value;
                                            setModelPreset(v);
                                            setModel(v);
                                        } }), _jsx(Input, { placeholder: "\u6216\u81EA\u5B9A\u4E49\uFF0C\u5982 o4-mini", value: model, className: "rounded-lg", onChange: (e) => {
                                            setModel(e.target.value);
                                            setModelPreset("");
                                        } })] })] }), _jsxs("div", { children: [_jsx(Label, { children: "\u6700\u5927\u5E76\u53D1" }), _jsx(Input, { type: "number", min: 1, value: maxParallel, className: "rounded-lg", onChange: (e) => setMaxParallel(e.target.value) })] })] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs(Label, { className: "!mb-0", children: ["\u4EFB\u52A1 \u00B7 ", rows.length] }), _jsx("button", { type: "button", onClick: addRow, className: "text-xs text-muted-foreground hover:text-foreground transition-smooth", children: "+ \u6DFB\u52A0\u4EFB\u52A1" })] }), rows.map((row, idx) => (_jsxs("div", { className: "rounded-lg border border-border/50 bg-card shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border/50 bg-muted/30 px-3 py-1.5 rounded-t-lg", children: [_jsxs("span", { className: "text-[10px] font-medium text-muted-foreground", children: ["#", String(idx).padStart(2, "0")] }), rows.length > 1 && (_jsx("button", { type: "button", onClick: () => removeRow(idx), className: "text-[10px] text-destructive hover:underline", children: "\u2715 \u5220\u9664" }))] }), _jsxs("div", { className: "space-y-2 p-3", children: [_jsx(Input, { placeholder: "\u6807\u9898\uFF08\u77ED\u63CF\u8FF0\uFF09", className: "rounded-lg", value: row.title, onChange: (e) => updateRow(idx, { title: e.target.value }) }), _jsx("textarea", { className: "flex min-h-[64px] w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-[12px] ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", placeholder: "Prompt\uFF08\u4EFB\u52A1\u6307\u4EE4\uFF09", value: row.prompt, onChange: (e) => updateRow(idx, { prompt: e.target.value }) }), _jsxs("div", { className: "grid grid-cols-3 gap-2", children: [_jsx(Select, { options: AGENT_OPTIONS, value: row.agent_id, onChange: (e) => updateRow(idx, { agent_id: e.target.value }) }), _jsx(Input, { placeholder: "Phase (0)", className: "rounded-lg", value: row.phase, onChange: (e) => updateRow(idx, { phase: e.target.value }) }), _jsx(Input, { placeholder: "Depends on (0,1)", className: "rounded-lg", value: row.depends_on, onChange: (e) => updateRow(idx, { depends_on: e.target.value }) })] }), selectedGroupId && groupMemberCwds.length > 0 && (_jsx("div", { children: _jsx(Select, { options: [
                                                { value: "", label: "目标仓库（默认继承组 primary）" },
                                                ...groupMemberCwds,
                                            ], value: row.cwd, onChange: (e) => updateRow(idx, { cwd: e.target.value }) }) }))] })] }, idx)))] }), _jsx("div", { className: "flex items-center justify-end gap-2", children: _jsx(Button, { type: "submit", disabled: submitDisabled, children: create.isPending ? "创建中…" : "▶ 创建 Plan" }) }), selectedGroupId && !groupPrimary && (_jsx("p", { className: "text-xs text-destructive", children: "\u9879\u76EE\u7EC4\u6210\u5458\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u4E3A\u8BE5\u7EC4\u6DFB\u52A0\u9879\u76EE\u3002" })), create.isError && (_jsxs("p", { className: "text-xs text-destructive", children: ["\u521B\u5EFA\u5931\u8D25\uFF1A", String(create.error)] }))] }));
}
function Label({ children, className = "", }) {
    return (_jsx("div", { className: `mb-1.5 text-xs font-medium text-muted-foreground ${className}`, children: children }));
}
//# sourceMappingURL=PlanCreateForm.js.map