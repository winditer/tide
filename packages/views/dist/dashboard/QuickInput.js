"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, Select } from "@lark2codex/ui";
import { useCreateTaskMutation, useAgents } from "@lark2codex/core";
export function QuickInput() {
    var _a;
    const [prompt, setPrompt] = useState("");
    const [agentId, setAgentId] = useState("");
    const { data: agentsData } = useAgents();
    const createMutation = useCreateTaskMutation();
    const agentOptions = [
        { label: "自动", value: "" },
        ...((_a = agentsData === null || agentsData === void 0 ? void 0 : agentsData.agents.map((a) => ({ label: a.name, value: a.id }))) !== null && _a !== void 0 ? _a : []),
    ];
    function handleSubmit() {
        const trimmed = prompt.trim();
        if (!trimmed)
            return;
        createMutation.mutate({
            prompt: trimmed,
            agent_id: agentId || undefined,
        }, {
            onSuccess: () => {
                setPrompt("");
            },
        });
    }
    function handleKeyDown(e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
        }
    }
    return (_jsxs("div", { className: "flex items-end gap-3 rounded-lg border bg-card p-3 shadow-sm", children: [_jsx("textarea", { className: "flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", rows: 2, placeholder: "\u8F93\u5165\u4EFB\u52A1\u6307\u4EE4... (Ctrl+Enter \u63D0\u4EA4)", value: prompt, onChange: (e) => setPrompt(e.target.value), onKeyDown: handleKeyDown }), _jsx("div", { className: "w-28 shrink-0", children: _jsx(Select, { options: agentOptions, value: agentId, onChange: (e) => setAgentId(e.target.value) }) }), _jsx(Button, { onClick: handleSubmit, disabled: !prompt.trim() || createMutation.isPending, children: createMutation.isPending ? "提交中..." : "执行" })] }));
}
//# sourceMappingURL=QuickInput.js.map