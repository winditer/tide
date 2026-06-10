"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePlanTasks } from "@tide/core";
import { useTaskQuery } from "@tide/core";
const MonacoDiffEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.DiffEditor), { ssr: false, loading: () => _jsx(DiffSkeleton, {}) });
function DiffSkeleton() {
    return (_jsx("div", { className: "flex h-full items-center justify-center font-mono text-xs tracking-widest text-zinc-500", children: "\u25D0 LOADING MONACO\u2026" }));
}
// Parse diff_summary - support unified diff or raw text
function parseDiff(raw) {
    var _a, _b, _c;
    if (!raw)
        return { original: "", modified: "", language: "plaintext" };
    // Try parsing as JSON first
    try {
        const obj = JSON.parse(raw);
        if (typeof obj === "object" && obj !== null) {
            if ("original" in obj && "modified" in obj) {
                return {
                    original: String((_a = obj.original) !== null && _a !== void 0 ? _a : ""),
                    modified: String((_b = obj.modified) !== null && _b !== void 0 ? _b : ""),
                    language: String((_c = obj.language) !== null && _c !== void 0 ? _c : "plaintext"),
                };
            }
        }
    }
    catch (_d) {
        // not JSON
    }
    // Treat as unified diff: split by lines, "-" goes to original, "+" goes to modified
    const lines = raw.split("\n");
    const original = [];
    const modified = [];
    let inHunk = false;
    for (const line of lines) {
        if (line.startsWith("@@")) {
            inHunk = true;
            continue;
        }
        if (line.startsWith("diff ") ||
            line.startsWith("index ") ||
            line.startsWith("--- ") ||
            line.startsWith("+++ ")) {
            continue;
        }
        if (!inHunk) {
            // Not a unified diff: show raw on right side
            return {
                original: "",
                modified: raw,
                language: "plaintext",
            };
        }
        if (line.startsWith("-"))
            original.push(line.slice(1));
        else if (line.startsWith("+"))
            modified.push(line.slice(1));
        else if (line.startsWith(" ")) {
            original.push(line.slice(1));
            modified.push(line.slice(1));
        }
    }
    return {
        original: original.join("\n"),
        modified: modified.join("\n"),
        language: "plaintext",
    };
}
export function DiffViewer({ planId }) {
    var _a, _b, _c, _d;
    const { data: tasks, isLoading } = usePlanTasks(planId);
    const [selectedTaskId, setSelectedTaskId] = useState(null);
    const tasksWithDiff = tasks !== null && tasks !== void 0 ? tasks : [];
    const activeId = (_b = selectedTaskId !== null && selectedTaskId !== void 0 ? selectedTaskId : (_a = tasksWithDiff[0]) === null || _a === void 0 ? void 0 : _a.task_id) !== null && _b !== void 0 ? _b : null;
    const { data: activeTask } = useTaskQuery(activeId !== null && activeId !== void 0 ? activeId : "");
    const parsed = useMemo(() => parseDiff(activeTask === null || activeTask === void 0 ? void 0 : activeTask.diff_summary), [activeTask === null || activeTask === void 0 ? void 0 : activeTask.diff_summary]);
    if (isLoading) {
        return (_jsx("div", { className: "flex h-96 items-center justify-center font-mono text-xs tracking-widest text-zinc-500", children: "\u25D0 LOADING TASKS\u2026" }));
    }
    if (tasksWithDiff.length === 0) {
        return (_jsx("div", { className: "flex h-96 items-center justify-center border border-zinc-900 bg-white font-mono text-xs tracking-widest text-zinc-500", children: "\u25C7 NO TASKS IN THIS PLAN" }));
    }
    return (_jsxs("div", { className: "border border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-900 bg-zinc-950 px-4 py-2 text-white", children: [_jsx("span", { className: "font-mono text-[10px] tracking-[0.3em]", children: "DIFF \u00B7 MONACO" }), _jsxs("span", { className: "font-mono text-[10px] tracking-widest text-zinc-400", children: [tasksWithDiff.length, " TASK", tasksWithDiff.length !== 1 ? "S" : ""] })] }), _jsxs("div", { className: "grid grid-cols-[260px_1fr]", children: [_jsxs("div", { className: "border-r border-dashed border-zinc-300", children: [_jsx("div", { className: "border-b border-dashed border-zinc-300 px-4 py-2 font-mono text-[10px] tracking-widest text-zinc-500", children: "TASKS" }), _jsx("div", { className: "max-h-[600px] overflow-auto", children: tasksWithDiff.map((t) => {
                                    const active = t.task_id === activeId;
                                    return (_jsxs("button", { onClick: () => setSelectedTaskId(t.task_id), className: [
                                            "flex w-full items-center gap-2 border-b border-dashed border-zinc-200 px-4 py-2 text-left transition-colors",
                                            active
                                                ? "bg-zinc-900 text-white"
                                                : "hover:bg-zinc-50",
                                        ].join(" "), children: [_jsxs("span", { className: `font-mono text-[10px] ${active ? "text-zinc-300" : "text-zinc-400"}`, children: ["#", String(t.task_index).padStart(2, "0")] }), _jsx("span", { className: "truncate text-[12px] font-medium", children: t.title || t.task_id.slice(0, 8) })] }, t.task_id));
                                }) })] }), _jsxs("div", { className: "flex flex-col", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-dashed border-zinc-300 px-4 py-2", children: [_jsx("span", { className: "truncate font-mono text-[11px] text-zinc-700", children: (_d = (_c = activeTask === null || activeTask === void 0 ? void 0 : activeTask.prompt) === null || _c === void 0 ? void 0 : _c.slice(0, 80)) !== null && _d !== void 0 ? _d : "—" }), !(activeTask === null || activeTask === void 0 ? void 0 : activeTask.diff_summary) && (_jsx("span", { className: "ml-2 shrink-0 font-mono text-[10px] tracking-widest text-zinc-400", children: "\u25C7 NO DIFF" }))] }), _jsx("div", { style: { height: 560 }, children: (activeTask === null || activeTask === void 0 ? void 0 : activeTask.diff_summary) ? (_jsx(MonacoDiffEditor, { height: "100%", original: parsed.original, modified: parsed.modified, language: parsed.language, theme: "vs-dark", options: {
                                        readOnly: true,
                                        renderSideBySide: true,
                                        minimap: { enabled: false },
                                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                        fontSize: 12,
                                        scrollBeyondLastLine: false,
                                        renderWhitespace: "boundary",
                                    } })) : (_jsx("div", { className: "flex h-full items-center justify-center font-mono text-xs tracking-widest text-zinc-400", children: "\u25C7 THIS TASK HAS NO DIFF SUMMARY" })) })] })] })] }));
}
//# sourceMappingURL=DiffViewer.js.map