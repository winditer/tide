"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, Input } from "@tide/ui";
import { useCreateWorkflow } from "@tide/core";
const STARTER_DEFINITION = {
    nodes: [
        {
            id: "start_1",
            type: "start",
            position: { x: 280, y: 60 },
            data: { label: "Start" },
        },
        {
            id: "end_1",
            type: "end",
            position: { x: 280, y: 280 },
            data: { label: "Done" },
        },
    ],
    edges: [
        {
            id: "e_start_1_end_1",
            source: "start_1",
            target: "end_1",
        },
    ],
};
export function WorkflowCreateForm({ onSuccess, onCancel, }) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const create = useCreateWorkflow();
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim())
            return;
        try {
            const wf = await create.mutateAsync({
                name: name.trim(),
                description: description.trim(),
                definition: STARTER_DEFINITION,
                enabled: true,
            });
            onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess(wf.id);
        }
        catch (_a) {
            // surfaced via mutation state
        }
    };
    return (_jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "NAME *" }), _jsx(Input, { placeholder: "\u5982\uFF1A\u4EE3\u7801\u8BC4\u5BA1\u6D41\u6C34\u7EBF", value: name, onChange: (e) => setName(e.target.value), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1.5 block font-mono text-[10px] tracking-[0.2em] text-zinc-700", children: "DESCRIPTION" }), _jsx("textarea", { className: "flex min-h-[80px] w-full rounded-none border-2 border-zinc-900 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900", placeholder: "\u63CF\u8FF0\u5DE5\u4F5C\u6D41\u7684\u7528\u9014\u4E0E\u89E6\u53D1\u6761\u4EF6\u2026", value: description, onChange: (e) => setDescription(e.target.value) })] }), _jsx("div", { className: "border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[10px] leading-relaxed tracking-wider text-zinc-600", children: "\u25C7 \u521B\u5EFA\u540E\u5C06\u8FDB\u5165\u53EF\u89C6\u5316\u7F16\u8F91\u5668\uFF0C\u5305\u542B START \u2192 END \u8D77\u59CB\u6A21\u677F\u3002" }), _jsxs("div", { className: "flex items-center justify-end gap-2", children: [onCancel && (_jsx(Button, { type: "button", variant: "outline", onClick: onCancel, children: "\u53D6\u6D88" })), _jsx(Button, { type: "submit", disabled: create.isPending || !name.trim(), children: create.isPending ? "创建中…" : "+ 创建工作流" })] }), create.isError && (_jsxs("p", { className: "font-mono text-xs text-rose-600", children: ["\u2715 \u521B\u5EFA\u5931\u8D25\uFF1A", String(create.error)] }))] }));
}
//# sourceMappingURL=WorkflowCreateForm.js.map