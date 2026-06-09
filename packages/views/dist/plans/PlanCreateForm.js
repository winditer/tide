"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, Input, Select } from "@lark2codex/ui";
import { useCreatePlan } from "@lark2codex/core";
const AGENT_OPTIONS = [
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude" },
    { label: "Qoder CLI", value: "qoder" },
];
const emptyRow = () => ({
    title: "",
    prompt: "",
    agent_id: "codex",
    depends_on: "",
    phase: "0",
});
export function PlanCreateForm({ onSuccess }) {
    const [rows, setRows] = useState([emptyRow()]);
    const [model, setModel] = useState("");
    const [cwd, setCwd] = useState("");
    const [maxParallel, setMaxParallel] = useState("3");
    const create = useCreatePlan();
    const updateRow = (idx, patch) => {
        setRows((prev) => prev.map((r, i) => (i === idx ? Object.assign(Object.assign({}, r), patch) : r)));
    };
    const removeRow = (idx) => setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
    const addRow = () => setRows((prev) => [...prev, emptyRow()]);
    const buildTasks = () => {
        return rows
            .filter((r) => r.title.trim() && r.prompt.trim())
            .map((r) => ({
            title: r.title.trim(),
            prompt: r.prompt.trim(),
            agent_id: r.agent_id || "codex",
            phase: Number(r.phase) || 0,
            depends_on: r.depends_on
                .split(/[ ,]+/)
                .map((s) => Number(s))
                .filter((n) => Number.isFinite(n) && n >= 0),
        }));
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        const tasks = buildTasks();
        if (tasks.length === 0)
            return;
        try {
            const plan = await create.mutateAsync({
                definition: { tasks, max_parallel: Number(maxParallel) || 3 },
                cwd: cwd.trim() || undefined,
                model: model.trim() || undefined,
            });
            onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess(plan.id);
        }
        catch (_a) {
            // surfaced via mutation state
        }
    };
    return (_jsxs("form", { onSubmit: handleSubmit, className: "space-y-5", children: [_jsxs("div", { className: "grid grid-cols-3 gap-4", children: [_jsxs("div", { children: [_jsx(Label, { children: "MODEL" }), _jsx(Input, { placeholder: "e.g. o4-mini", value: model, onChange: (e) => setModel(e.target.value) })] }), _jsxs("div", { children: [_jsx(Label, { children: "WORKING DIR" }), _jsx(Input, { placeholder: "optional", value: cwd, onChange: (e) => setCwd(e.target.value) })] }), _jsxs("div", { children: [_jsx(Label, { children: "MAX PARALLEL" }), _jsx(Input, { type: "number", min: 1, value: maxParallel, onChange: (e) => setMaxParallel(e.target.value) })] })] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs(Label, { className: "!mb-0", children: ["TASKS \u00B7 ", rows.length] }), _jsx("button", { type: "button", onClick: addRow, className: "font-mono text-[10px] tracking-widest text-zinc-700 underline-offset-4 hover:underline", children: "+ ADD TASK" })] }), rows.map((row, idx) => (_jsxs("div", { className: "border border-zinc-900 bg-white shadow-[3px_3px_0_0_rgba(24,24,27,0.92)]", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-dashed border-zinc-300 bg-zinc-50 px-3 py-1.5", children: [_jsxs("span", { className: "font-mono text-[10px] tracking-widest text-zinc-700", children: ["#", String(idx).padStart(2, "0")] }), rows.length > 1 && (_jsx("button", { type: "button", onClick: () => removeRow(idx), className: "font-mono text-[10px] tracking-widest text-rose-600 hover:underline", children: "\u2715 REMOVE" }))] }), _jsxs("div", { className: "space-y-2 p-3", children: [_jsx(Input, { placeholder: "Title (\u77ED\u63CF\u8FF0)", value: row.title, onChange: (e) => updateRow(idx, { title: e.target.value }) }), _jsx("textarea", { className: "flex min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", placeholder: "Prompt (\u4EFB\u52A1\u6307\u4EE4)", value: row.prompt, onChange: (e) => updateRow(idx, { prompt: e.target.value }) }), _jsxs("div", { className: "grid grid-cols-3 gap-2", children: [_jsx(Select, { options: AGENT_OPTIONS, value: row.agent_id, onChange: (e) => updateRow(idx, { agent_id: e.target.value }) }), _jsx(Input, { placeholder: "Phase (0)", value: row.phase, onChange: (e) => updateRow(idx, { phase: e.target.value }) }), _jsx(Input, { placeholder: "Depends on (e.g. 0,1)", value: row.depends_on, onChange: (e) => updateRow(idx, { depends_on: e.target.value }) })] })] })] }, idx)))] }), _jsx("div", { className: "flex items-center justify-end gap-2", children: _jsx(Button, { type: "submit", disabled: create.isPending, children: create.isPending ? "创建中…" : "▶ 创建 Plan" }) }), create.isError && (_jsxs("p", { className: "font-mono text-[11px] text-rose-600", children: ["\u521B\u5EFA\u5931\u8D25\uFF1A", String(create.error)] }))] }));
}
function Label({ children, className = "", }) {
    return (_jsx("div", { className: `mb-1 font-mono text-[10px] tracking-widest text-zinc-500 ${className}`, children: children }));
}
//# sourceMappingURL=PlanCreateForm.js.map