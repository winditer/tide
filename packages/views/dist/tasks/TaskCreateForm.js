"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, Input, Select } from "@lark2codex/ui";
import { useCreateTaskMutation } from "@lark2codex/core";
const AGENT_OPTIONS = [
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude" },
    { label: "Qoder CLI", value: "qoder" },
];
export function TaskCreateForm({ onSuccess }) {
    const [prompt, setPrompt] = useState("");
    const [agentId, setAgentId] = useState("codex");
    const [model, setModel] = useState("");
    const [cwd, setCwd] = useState("");
    const [attachments, setAttachments] = useState("");
    const createMutation = useCreateTaskMutation();
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!prompt.trim())
            return;
        try {
            await createMutation.mutateAsync({
                prompt: prompt.trim(),
                agent_id: agentId,
                model: model.trim() || undefined,
                cwd: cwd.trim() || undefined,
                attachments: attachments
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
            });
            setPrompt("");
            setModel("");
            setCwd("");
            setAttachments("");
            onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess();
        }
        catch (_a) {
            // error handled by mutation state
        }
    };
    return (_jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "Prompt *" }), _jsx("textarea", { className: "flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", placeholder: "\u8F93\u5165\u4EFB\u52A1\u6307\u4EE4...", value: prompt, onChange: (e) => setPrompt(e.target.value), required: true })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "Agent" }), _jsx(Select, { options: AGENT_OPTIONS, value: agentId, onChange: (e) => setAgentId(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u6A21\u578B" }), _jsx(Input, { placeholder: "\u53EF\u9009\uFF0C\u5982 o4-mini", value: model, onChange: (e) => setModel(e.target.value) })] })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u5DE5\u4F5C\u76EE\u5F55" }), _jsx(Input, { placeholder: "\u53EF\u9009\uFF0C\u9ED8\u8BA4\u4E3A\u5F53\u524D\u76EE\u5F55", value: cwd, onChange: (e) => setCwd(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block text-sm font-medium", children: "\u9644\u4EF6\u5F15\u7528" }), _jsx("textarea", { className: "flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", placeholder: "\u6BCF\u884C\u4E00\u4E2A\u6587\u4EF6\u8DEF\u5F84\u6216 URL", value: attachments, onChange: (e) => setAttachments(e.target.value) })] }), _jsx("div", { className: "flex justify-end gap-2", children: _jsx(Button, { type: "submit", disabled: createMutation.isPending || !prompt.trim(), children: createMutation.isPending ? "创建中..." : "创建任务" }) }), createMutation.isError && (_jsxs("p", { className: "text-sm text-destructive", children: ["\u521B\u5EFA\u5931\u8D25\uFF1A", String(createMutation.error)] }))] }));
}
//# sourceMappingURL=TaskCreateForm.js.map