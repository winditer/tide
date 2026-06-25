"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select } from "@tide/ui";
import { useCreateWorkItem, useVersions, useProjectMembers, useProjects, useProjectGroups, useProjectGroup, } from "@tide/core";
const PRIORITY_OPTIONS = [
    { value: "0", label: "无优先级" },
    { value: "1", label: "低" },
    { value: "2", label: "中" },
    { value: "3", label: "高" },
    { value: "4", label: "紧急" },
];
const SCOPE_PROJECT_PREFIX = "project:";
const SCOPE_GROUP_PREFIX = "group:";
/** 把传入的初始 scope 与 projectId 归一化为统一 selectValue。 */
function buildInitialScopeValue(initial, projectId) {
    if (initial && initial.startsWith(SCOPE_GROUP_PREFIX))
        return initial;
    if (initial && initial.startsWith(SCOPE_PROJECT_PREFIX))
        return initial;
    if (projectId)
        return `${SCOPE_PROJECT_PREFIX}${projectId}`;
    return "";
}
export function WorkItemCreateDialog({ projectId, initialScopeValue, onClose, onSuccess, }) {
    var _a, _b, _c, _d, _e, _f;
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [priority, setPriority] = useState("0");
    const [assignee, setAssignee] = useState("");
    const [tagsRaw, setTagsRaw] = useState("");
    const [versionId, setVersionId] = useState("");
    /**
     * 归属选择：与列表页统一编码。
     * - ``"project:<id>"`` -> 单仓库（创建时 project_id=<id>，group_id=null）
     * - ``"group:<id>"``   -> 项目组（project_id=组 primary，group_id=<id>）
     */
    const [scopeValue, setScopeValue] = useState(() => buildInitialScopeValue(initialScopeValue, projectId));
    const [error, setError] = useState(null);
    const createMutation = useCreateWorkItem();
    const { data: projectsData } = useProjects();
    const { data: groupsData } = useProjectGroups();
    const projects = (_a = projectsData === null || projectsData === void 0 ? void 0 : projectsData.projects) !== null && _a !== void 0 ? _a : [];
    const groups = (_b = groupsData === null || groupsData === void 0 ? void 0 : groupsData.groups) !== null && _b !== void 0 ? _b : [];
    const selectedGroupId = scopeValue.startsWith(SCOPE_GROUP_PREFIX)
        ? scopeValue.slice(SCOPE_GROUP_PREFIX.length)
        : undefined;
    const selectedProjectId = scopeValue.startsWith(SCOPE_PROJECT_PREFIX)
        ? scopeValue.slice(SCOPE_PROJECT_PREFIX.length)
        : undefined;
    const { data: groupDetail } = useProjectGroup(selectedGroupId);
    // 项目组模式下使用 primary 项目作为 project_id、拉取成员与版本；
    // 项目模式下使用所选项目 id；fallback 至 props.projectId 以兼容旧调用方。
    const primaryProjectId = useMemo(() => {
        var _a, _b;
        if (!groupDetail)
            return undefined;
        const primary = groupDetail.members.find((m) => m.role === "primary");
        return (_a = primary === null || primary === void 0 ? void 0 : primary.project_id) !== null && _a !== void 0 ? _a : (_b = groupDetail.members[0]) === null || _b === void 0 ? void 0 : _b.project_id;
    }, [groupDetail]);
    const effectiveProjectId = selectedGroupId
        ? (primaryProjectId !== null && primaryProjectId !== void 0 ? primaryProjectId : projectId)
        : (selectedProjectId !== null && selectedProjectId !== void 0 ? selectedProjectId : projectId);
    const { data: versions = [] } = useVersions(effectiveProjectId);
    const { data: membersData } = useProjectMembers(effectiveProjectId);
    // 归属变更时重置下拉选择，避免跨项目残留选项
    useEffect(() => {
        setVersionId("");
        setAssignee("");
    }, [scopeValue]);
    // 归属下拉：项目分组 + 项目组分组
    const scopeFlatOptions = useMemo(() => {
        // 当 props.projectId 不在项目列表中时（例如调用方传入了非法 id 或项目列表尚未加载完成），
        // 提供一个隐藏 fallback 选项保证 <select> 受控值能匹配。
        const inProjects = projects.some((p) => p.id === projectId);
        if (!projectId || inProjects)
            return [];
        return [
            {
                value: `${SCOPE_PROJECT_PREFIX}${projectId}`,
                label: "当前项目",
            },
        ];
    }, [projects, projectId]);
    const scopeGroups = useMemo(() => {
        const res = [];
        if (projects.length > 0) {
            res.push({
                label: "项目",
                options: projects.map((p) => ({
                    value: `${SCOPE_PROJECT_PREFIX}${p.id}`,
                    label: p.name,
                })),
            });
        }
        if (groups.length > 0) {
            res.push({
                label: "项目组",
                options: groups.map((g) => ({
                    value: `${SCOPE_GROUP_PREFIX}${g.id}`,
                    label: `${g.name} (${g.member_count})`,
                })),
            });
        }
        return res;
    }, [projects, groups]);
    const assigneeOptions = useMemo(() => {
        var _a;
        const opts = [{ value: "", label: "未指定" }];
        for (const m of (_a = membersData === null || membersData === void 0 ? void 0 : membersData.members) !== null && _a !== void 0 ? _a : []) {
            const name = m.display_name || m.username;
            opts.push({ value: name, label: name });
        }
        return opts;
    }, [membersData]);
    const versionOptions = useMemo(() => {
        const opts = [{ value: "", label: "不关联版本" }];
        for (const v of versions) {
            const suffix = v.status === "released"
                ? " · 已发布"
                : v.status === "archived"
                    ? " · 已归档"
                    : "";
            opts.push({ value: v.id, label: `${v.name}${suffix}` });
        }
        return opts;
    }, [versions]);
    const handleSubmit = async () => {
        setError(null);
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            setError("标题不能为空");
            return;
        }
        if (selectedGroupId && !primaryProjectId) {
            setError("项目组成员为空，请先为该组添加项目");
            return;
        }
        if (!effectiveProjectId) {
            setError("请先选择项目或项目组");
            return;
        }
        try {
            await createMutation.mutateAsync({
                project_id: effectiveProjectId,
                title: trimmedTitle,
                description: description.trim() || undefined,
                priority: Number(priority),
                assignee: assignee.trim() || undefined,
                tags: tagsRaw
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                version_id: versionId || null,
                group_id: selectedGroupId !== null && selectedGroupId !== void 0 ? selectedGroupId : null,
            });
            onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess();
            onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in-0", onClick: onClose, children: _jsxs("div", { className: "relative w-full max-w-lg overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl animate-in zoom-in-95 fade-in-0", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border/60 bg-muted/30 px-6 py-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-lg font-semibold tracking-tight text-foreground", children: "\u65B0\u5EFA\u5DE5\u4F5C\u9879" }), _jsx("p", { className: "mt-0.5 text-xs text-muted-foreground", children: "\u5728\u6240\u9009\u9879\u76EE\u6216\u9879\u76EE\u7EC4\u4E2D\u521B\u5EFA\u4E00\u4E2A\u65B0\u7684\u5DE5\u4F5C\u9879" })] }), _jsx("button", { onClick: onClose, "aria-label": "\u5173\u95ED", className: "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground", children: "\u2715" })] }), _jsxs("div", { className: "space-y-5 p-6", children: [_jsxs(Field, { label: "\u5F52\u5C5E", required: true, children: [_jsx(Select, { value: scopeValue, onChange: (e) => setScopeValue(e.target.value), options: scopeFlatOptions, groups: scopeGroups, className: "h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring", "aria-label": "\u9009\u62E9\u9879\u76EE\u6216\u9879\u76EE\u7EC4" }), selectedGroupId && groupDetail && (_jsxs("p", { className: "mt-1.5 text-[11px] text-muted-foreground", children: ["\u5C06\u5728 primary \u9879\u76EE", " ", _jsx("span", { className: "font-mono text-foreground", children: (_f = (_d = (_c = groupDetail.members.find((m) => m.role === "primary")) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : (_e = groupDetail.members[0]) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "—" }), " ", "\u4E2D\u521B\u5EFA\uFF0C\u540E\u7AEF\u4F1A\u4E3A Agent \u8282\u70B9\u6CE8\u5165\u8DE8\u4ED3\u5E93\u4E0A\u4E0B\u6587\u3002"] }))] }), _jsx(Field, { label: "\u6807\u9898", required: true, children: _jsx(Input, { autoFocus: true, placeholder: "\u8F93\u5165\u5DE5\u4F5C\u9879\u6807\u9898", value: title, onChange: (e) => setTitle(e.target.value), className: "h-10 rounded-lg border-0 bg-muted/50 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0" }) }), _jsx(Field, { label: "\u63CF\u8FF0", children: _jsx("textarea", { placeholder: "\u53EF\u9009\u7684\u8BE6\u7EC6\u63CF\u8FF0", value: description, onChange: (e) => setDescription(e.target.value), rows: 3, className: "w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" }) }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u4F18\u5148\u7EA7", children: _jsx(Select, { value: priority, onChange: (e) => setPriority(e.target.value), className: "h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring", options: PRIORITY_OPTIONS }) }), _jsx(Field, { label: "\u8D1F\u8D23\u4EBA", children: _jsx(Select, { value: assignee, onChange: (e) => setAssignee(e.target.value), options: assigneeOptions, className: "h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring" }) })] }), _jsx(Field, { label: "\u6807\u7B7E\uFF08\u9017\u53F7\u5206\u9694\uFF09", children: _jsx(Input, { placeholder: "bug, feature, urgent", value: tagsRaw, onChange: (e) => setTagsRaw(e.target.value), className: "h-10 rounded-lg border-0 bg-muted/50 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0" }) }), _jsx(Field, { label: "\u7248\u672C\uFF08\u53EF\u9009\uFF09", children: _jsx(Select, { value: versionId, onChange: (e) => setVersionId(e.target.value), options: versionOptions, className: "h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring" }) }), error && (_jsx("div", { className: "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive", children: error }))] }), _jsxs("div", { className: "flex justify-end gap-2 border-t border-border/60 bg-muted/20 px-6 py-3", children: [_jsx(Button, { variant: "outline", onClick: onClose, children: "\u53D6\u6D88" }), _jsx(Button, { disabled: createMutation.isPending, onClick: handleSubmit, children: createMutation.isPending ? "创建中…" : "创建工作项" })] })] }) }));
}
function Field({ label, required, children, }) {
    return (_jsxs("label", { className: "block", children: [_jsxs("span", { className: "mb-1.5 block text-xs font-medium text-muted-foreground", children: [label, required && _jsx("span", { className: "ml-0.5 text-destructive", children: "*" })] }), children] }));
}
//# sourceMappingURL=WorkItemCreateDialog.js.map