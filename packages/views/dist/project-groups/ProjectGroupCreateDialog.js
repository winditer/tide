"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { Button, Input } from "@tide/ui";
import { useCreateProjectGroup, } from "@tide/core";
/**
 * 新建项目组对话框：填写名称/描述，并从已有项目列表中多选成员。
 * 选择顺序敏感 —— 第一个被选择的项目将被后端标记为 ``primary``。
 */
export function ProjectGroupCreateDialog({ projects, workspaceId, onClose, onSuccess, }) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [selected, setSelected] = useState([]);
    const [search, setSearch] = useState("");
    const [error, setError] = useState(null);
    const createMutation = useCreateProjectGroup();
    const filteredProjects = useMemo(() => {
        const kw = search.trim().toLowerCase();
        if (!kw)
            return projects;
        return projects.filter((p) => p.name.toLowerCase().includes(kw) ||
            p.cwd.toLowerCase().includes(kw));
    }, [projects, search]);
    const toggleProject = (projectId) => {
        setSelected((prev) => prev.includes(projectId)
            ? prev.filter((id) => id !== projectId)
            : [...prev, projectId]);
    };
    const handleSubmit = async () => {
        setError(null);
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError("请填写项目组名称");
            return;
        }
        try {
            const input = {
                name: trimmedName,
                description: description.trim() || undefined,
                workspace_id: workspaceId,
                project_ids: selected,
            };
            const group = await createMutation.mutateAsync(input);
            onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess(group.id);
            onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4", onClick: onClose, children: _jsxs("div", { className: "relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border/50 bg-card shadow-2xl", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border/50 px-5 py-3", children: [_jsx("span", { className: "text-xs font-medium uppercase tracking-wider text-muted-foreground", children: "NEW \u00B7 GROUP" }), _jsx("button", { onClick: onClose, "aria-label": "\u5173\u95ED", className: "text-sm text-muted-foreground transition-smooth hover:text-foreground", children: "\u2715" })] }), _jsxs("div", { className: "flex-1 space-y-5 overflow-y-auto p-6", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-semibold tracking-tight", children: "\u65B0\u5EFA\u9879\u76EE\u7EC4" }), _jsx("p", { className: "mt-1 text-sm text-muted-foreground", children: "\u5C06\u591A\u4E2A\u4ED3\u5E93\u805A\u5408\u5230\u4E00\u4E2A\u7EC4\u4E2D\uFF0C\u4FBF\u4E8E\u8DE8\u4ED3\u5E93\u5DE5\u4F5C\u9879\u7F16\u6392" })] }), _jsx(Field, { label: "\u7EC4\u540D\u79F0", required: true, children: _jsx(Input, { autoFocus: true, placeholder: "\u4F8B\u5982\uFF1A\u7535\u5546\u524D\u540E\u7AEF", value: name, onChange: (e) => setName(e.target.value), className: "rounded-lg border-border/50 focus:ring-2 focus:ring-ring" }) }), _jsx(Field, { label: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", children: _jsx("textarea", { placeholder: "\u63CF\u8FF0\u8FD9\u4E2A\u9879\u76EE\u7EC4\u7684\u7528\u9014\u3001\u8303\u56F4\u7B49", value: description, onChange: (e) => setDescription(e.target.value), rows: 3, className: "w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" }) }), _jsxs("div", { children: [_jsxs("div", { className: "mb-1.5 flex items-center justify-between", children: [_jsxs("span", { className: "text-sm font-medium text-foreground", children: ["\u9009\u62E9\u6210\u5458\u9879\u76EE", _jsxs("span", { className: "ml-2 text-xs text-muted-foreground", children: ["\u5DF2\u9009 ", selected.length, " \u4E2A", selected.length > 0 ? "（首个为 primary）" : ""] })] }), _jsx(Input, { placeholder: "\u641C\u7D22\u9879\u76EE\u2026", value: search, onChange: (e) => setSearch(e.target.value), className: "h-8 w-44 rounded-md border-border/50 text-xs" })] }), _jsx("div", { className: "max-h-72 overflow-y-auto rounded-lg border border-border/60 bg-muted/30", children: filteredProjects.length === 0 ? (_jsx("div", { className: "py-10 text-center text-xs text-muted-foreground", children: "\u6CA1\u6709\u53EF\u9009\u7684\u9879\u76EE" })) : (_jsx("ul", { className: "divide-y divide-border/40", children: filteredProjects.map((p) => {
                                            const isSel = selected.includes(p.id);
                                            const order = isSel
                                                ? selected.indexOf(p.id) + 1
                                                : 0;
                                            return (_jsxs("li", { onClick: () => toggleProject(p.id), className: "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors " +
                                                    (isSel
                                                        ? "bg-primary/5 hover:bg-primary/10"
                                                        : "hover:bg-muted/60"), children: [_jsx("span", { className: "flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-mono " +
                                                            (isSel
                                                                ? "border-primary bg-primary text-primary-foreground"
                                                                : "border-border bg-background text-muted-foreground"), children: isSel ? order : "" }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "truncate text-sm font-medium", children: p.name }), isSel && order === 1 && (_jsx("span", { className: "rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary", children: "primary" }))] }), _jsx("div", { className: "truncate font-mono text-[11px] text-muted-foreground", children: p.cwd })] })] }, p.id));
                                        }) })) })] }), error && (_jsxs("div", { className: "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive", children: ["\u2715 ", error] }))] }), _jsxs("div", { className: "flex justify-end gap-2 border-t border-border/50 bg-muted/20 px-6 py-3", children: [_jsx(Button, { variant: "outline", onClick: onClose, children: "\u53D6\u6D88" }), _jsx(Button, { disabled: createMutation.isPending, onClick: handleSubmit, children: createMutation.isPending ? "保存中…" : "创建项目组" })] })] }) }));
}
function Field({ label, required, children, }) {
    return (_jsxs("label", { className: "block", children: [_jsxs("span", { className: "mb-1.5 block text-sm font-medium text-foreground", children: [label, required && _jsx("span", { className: "ml-1 text-destructive", children: "*" })] }), children] }));
}
//# sourceMappingURL=ProjectGroupCreateDialog.js.map