"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button, Select, Input } from "@tide/ui";
import { useAgents, useProjects, useSessions } from "@tide/core";
const STATUS_OPTIONS = [
    { label: "全部状态", value: "" },
    { label: "排队中", value: "queued" },
    { label: "运行中", value: "running" },
    { label: "待审批", value: "review" },
    { label: "已完成", value: "completed" },
    { label: "失败", value: "failed" },
    { label: "已停止", value: "stopped" },
];
function shortSession(id) {
    if (!id)
        return "";
    return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
function projectName(cwd) {
    return cwd.replace(/\/+$/, "").split("/").pop() || cwd;
}
export function TaskFilters({ value, onChange, onReset }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const { data: projectsData } = useProjects();
    const { data: agentsData } = useAgents();
    const { data: sessionsData } = useSessions({
        project: value.project || undefined,
        agent_id: value.agent_id || undefined,
        page_size: 200,
    });
    const projectOptions = [
        { label: "全部项目", value: "" },
        ...((_a = projectsData === null || projectsData === void 0 ? void 0 : projectsData.projects) !== null && _a !== void 0 ? _a : []).map((p) => ({
            label: `${p.name}${p.cwd && p.cwd !== p.name ? `  (${p.cwd})` : ""}`,
            value: p.cwd,
        })),
    ];
    const agentOptions = [
        { label: "全部 Agent", value: "" },
        ...((_b = agentsData === null || agentsData === void 0 ? void 0 : agentsData.agents) !== null && _b !== void 0 ? _b : []).map((a) => ({
            label: a.name || a.id,
            value: a.id,
        })),
    ];
    const sessionOptions = [
        { label: "全部会话", value: "" },
        ...((_c = sessionsData === null || sessionsData === void 0 ? void 0 : sessionsData.sessions) !== null && _c !== void 0 ? _c : [])
            .filter((s) => !!s.session_id)
            .map((s) => ({
            label: `${shortSession(s.session_id)}${s.cwd ? ` · ${projectName(s.cwd)}` : ""}${s.agent_id ? ` · ${s.agent_id}` : ""}`,
            value: s.session_id,
        })),
    ];
    const update = (patch) => {
        onChange(Object.assign(Object.assign({}, value), patch));
    };
    const hasActive = !!value.status ||
        !!value.agent_id ||
        !!value.project ||
        !!value.session_id ||
        !!value.created_after ||
        !!value.created_before;
    return (_jsx("div", { className: "mb-4 rounded-lg border bg-card/40 p-3", children: _jsxs("div", { className: "flex flex-wrap items-end gap-3", children: [_jsx(FilterField, { label: "\u9879\u76EE", className: "min-w-[150px] flex-1 basis-[160px] max-w-[240px]", children: _jsx(Select, { options: projectOptions, value: (_d = value.project) !== null && _d !== void 0 ? _d : "", onChange: (e) => update({ project: e.target.value || undefined }) }) }), _jsx(FilterField, { label: "\u4F1A\u8BDD", className: "min-w-[150px] flex-1 basis-[160px] max-w-[240px]", children: _jsx(Select, { options: sessionOptions, value: (_e = value.session_id) !== null && _e !== void 0 ? _e : "", onChange: (e) => update({ session_id: e.target.value || undefined }) }) }), _jsx(FilterField, { label: "Agent", className: "w-[120px] flex-shrink-0", children: _jsx(Select, { options: agentOptions, value: (_f = value.agent_id) !== null && _f !== void 0 ? _f : "", onChange: (e) => update({ agent_id: e.target.value || undefined }) }) }), _jsx(FilterField, { label: "\u72B6\u6001", className: "w-[110px] flex-shrink-0", children: _jsx(Select, { options: STATUS_OPTIONS, value: (_g = value.status) !== null && _g !== void 0 ? _g : "", onChange: (e) => update({ status: e.target.value || undefined }) }) }), _jsx(FilterField, { label: "\u521B\u5EFA\u65F6\u95F4", className: "flex-1 min-w-[220px] basis-[240px]", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Input, { type: "date", className: "min-w-0 flex-1", value: (_j = (_h = value.created_after) === null || _h === void 0 ? void 0 : _h.slice(0, 10)) !== null && _j !== void 0 ? _j : "", onChange: (e) => update({
                                    created_after: e.target.value
                                        ? `${e.target.value}T00:00:00`
                                        : undefined,
                                }) }), _jsx("span", { className: "text-muted-foreground", children: "\u2192" }), _jsx(Input, { type: "date", className: "min-w-0 flex-1", value: (_l = (_k = value.created_before) === null || _k === void 0 ? void 0 : _k.slice(0, 10)) !== null && _l !== void 0 ? _l : "", onChange: (e) => update({
                                    created_before: e.target.value
                                        ? `${e.target.value}T23:59:59`
                                        : undefined,
                                }) })] }) }), _jsx(Button, { variant: "outline", size: "sm", disabled: !hasActive, onClick: onReset, className: "ml-auto flex-shrink-0 whitespace-nowrap", children: "\u6E05\u9664\u7B5B\u9009" })] }) }));
}
function FilterField({ label, children, className, }) {
    return (_jsxs("div", { className: className, children: [_jsx("label", { className: "mb-1 block text-xs font-medium text-muted-foreground", children: label }), children] }));
}
//# sourceMappingURL=TaskFilters.js.map