"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Button, Input, Select } from "@tide/ui";
import { useProjectMembers, getAgents, apiClient, } from "@tide/core";
import { STAGE_CATEGORY_OPTIONS } from "./node-tones";
const TYPE_LABEL = {
    start: "起始",
    end: "终止",
    agent: "Agent",
    approval: "审批",
    condition: "条件",
    parallel: "并行分发",
    parallel_join: "并行汇合",
    delay: "延时",
    stage: "阶段",
    git_merge: "Git合并",
};
const TYPE_GLYPH = {
    start: "▶",
    end: "■",
    agent: "🤖",
    approval: "🛡",
    condition: "◆",
    parallel: "＋",
    parallel_join: "−",
    delay: "⏱",
    stage: "✦",
    git_merge: "🔀",
};
const OPERATOR_OPTIONS = [
    { label: "等于 (==)", value: "eq" },
    { label: "不等于 (≠)", value: "ne" },
    { label: "大于 (>)", value: "gt" },
    { label: "小于 (<)", value: "lt" },
    { label: "大于等于 (≥)", value: "gte" },
    { label: "小于等于 (≤)", value: "lte" },
    { label: "包含 (⊃)", value: "contains" },
    { label: "不包含 (⊅)", value: "not_contains" },
];
const LOCAL_AGENT_OPTIONS = [
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude" },
    { label: "Qoder", value: "qoder" },
];
function isRemoteAgentId(id) {
    return typeof id === "string" && id.startsWith("a2a:");
}
export function PropertyPanel({ node, onUpdate, onDelete, readOnly, projectId, }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const { data: membersData } = useProjectMembers(projectId);
    const members = (_a = membersData === null || membersData === void 0 ? void 0 : membersData.members) !== null && _a !== void 0 ? _a : [];
    // 远程 Agent 列表：组件挂载时拉取一次，失败时降级为空数组仅显示本地 Agent。
    const [remoteAgents, setRemoteAgents] = useState([]);
    useEffect(() => {
        let cancelled = false;
        getAgents()
            .then((res) => {
            var _a;
            if (cancelled)
                return;
            const remotes = ((_a = res === null || res === void 0 ? void 0 : res.agents) !== null && _a !== void 0 ? _a : []).filter((a) => a.type === "remote" || isRemoteAgentId(a.id));
            setRemoteAgents(remotes);
        })
            .catch(() => {
            // 降级：保持空列表，仅展示本地 Agent
            if (!cancelled)
                setRemoteAgents([]);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    const [availableSkills, setAvailableSkills] = useState([]);
    const [skillSearch, setSkillSearch] = useState("");
    useEffect(() => {
        let cancelled = false;
        apiClient.get("/api/skills?workspace_id=default&limit=500")
            .then((data) => {
            if (!cancelled && Array.isArray(data))
                setAvailableSkills(data);
        })
            .catch(() => { });
        return () => { cancelled = true; };
    }, []);
    const filteredSkills = (() => {
        const q = skillSearch.trim().toLowerCase();
        if (!q)
            return availableSkills;
        return availableSkills.filter((skill) => [skill.name, skill.description, skill.id, skill.slug, skill.category]
            .some((field) => typeof field === "string" && field.toLowerCase().includes(q)));
    })();
    if (!node) {
        return (_jsxs("div", { className: "flex h-full w-[300px] flex-col border-l border-border/50 bg-card", children: [_jsx(Header, { type: null }), _jsxs("div", { className: "flex flex-1 flex-col items-center justify-center px-6 text-center", children: [_jsx("div", { className: "mb-2 text-xs font-medium text-muted-foreground", children: "\u672A\u9009\u4E2D\u8282\u70B9" }), _jsx("div", { className: "text-xs text-muted-foreground", children: "\u70B9\u51FB\u753B\u5E03\u4E2D\u7684\u8282\u70B9\u67E5\u770B\u4E0E\u7F16\u8F91\u5C5E\u6027" })] })] }));
    }
    const t = node.type;
    const data = (_b = node.data) !== null && _b !== void 0 ? _b : {};
    const update = (patch) => onUpdate(node.id, Object.assign(Object.assign({}, data), patch));
    return (_jsxs("div", { className: "flex h-full w-[300px] flex-col border-l border-border/50 bg-card", children: [_jsx(Header, { type: t }), _jsxs("div", { className: "border-b border-border/50 px-4 py-3", children: [_jsx(Field, { label: "ID", mono: true, value: node.id }), _jsxs("div", { className: "mt-2 grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "X", mono: true, value: String(Math.round(node.position.x)) }), _jsx(Field, { label: "Y", mono: true, value: String(Math.round(node.position.y)) })] })] }), _jsx("div", { className: "flex-1 overflow-y-auto px-4 py-3 divide-y divide-border/50", children: _jsxs("div", { className: "pb-3", children: [_jsx(FormGroup, { label: "\u540D\u79F0", children: _jsx(Input, { value: String((_c = data.label) !== null && _c !== void 0 ? _c : ""), disabled: readOnly, onChange: (e) => update({ label: e.target.value }), placeholder: "\u8282\u70B9\u540D\u79F0", className: "rounded-lg" }) }), t === "agent" && (() => {
                            var _a, _b, _c, _d, _e;
                            const currentAgentId = String((_b = (_a = data.agent_id) !== null && _a !== void 0 ? _a : data.agentId) !== null && _b !== void 0 ? _b : "codex");
                            const isRemote = isRemoteAgentId(currentAgentId);
                            const selectedRemote = isRemote
                                ? remoteAgents.find((a) => a.id === currentAgentId)
                                : undefined;
                            return (_jsxs(_Fragment, { children: [!isRemote && (_jsx(FormGroup, { label: "\u6A21\u578B", children: _jsx(Input, { value: String((_c = data.model) !== null && _c !== void 0 ? _c : ""), disabled: readOnly, onChange: (e) => update({ model: e.target.value }), placeholder: "\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u6A21\u578B", className: "rounded-lg" }) })), _jsx(FormGroup, { label: "Agent", children: _jsx(AgentSelect, { value: currentAgentId, disabled: readOnly, remoteAgents: remoteAgents, onChange: (next) => update({
                                                agent_id: next,
                                                // 同步写入 camelCase 别名，保证与后端/其他调用点兼容
                                                agentId: next,
                                            }) }) }), isRemote && (_jsx(FormGroup, { label: "Skills", children: _jsx(RemoteAgentSkills, { agent: selectedRemote }) })), !isRemote && availableSkills.length > 0 && (_jsxs(FormGroup, { label: "\u6280\u80FD\u6CE8\u5165", children: [_jsxs("div", { className: "relative mb-1.5", children: [_jsx("span", { className: "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70", children: "\u2315" }), _jsx("input", { type: "text", value: skillSearch, onChange: (e) => setSkillSearch(e.target.value), disabled: readOnly, placeholder: "\u641C\u7D22 Skill\uFF08\u540D\u79F0 / \u63CF\u8FF0 / \u5206\u7C7B\uFF09", className: "flex h-7 w-full rounded-md border border-input bg-background pl-7 pr-7 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50" }), skillSearch && (_jsx("button", { type: "button", onClick: () => setSkillSearch(""), disabled: readOnly, "aria-label": "\u6E05\u9664\u641C\u7D22", className: "absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[11px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", children: "\u2715" }))] }), _jsxs("div", { className: "max-h-[160px] overflow-y-auto rounded-lg border border-input bg-background p-2 space-y-1", children: [filteredSkills.map((skill) => {
                                                        const currentSkills = Array.isArray(data.skills) ? data.skills : [];
                                                        const checked = currentSkills.includes(skill.slug);
                                                        return (_jsxs("label", { className: `flex items-center gap-2 rounded px-2 py-1.5 text-[12px] transition-colors ${readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40"}`, children: [_jsx("input", { type: "checkbox", className: "h-3.5 w-3.5 accent-primary", checked: checked, disabled: readOnly, onChange: () => {
                                                                        const next = checked
                                                                            ? currentSkills.filter((s) => s !== skill.slug)
                                                                            : [...currentSkills, skill.slug];
                                                                        update({ skills: next });
                                                                    } }), _jsx("span", { className: "font-medium text-foreground", children: skill.name }), skill.category && (_jsx("span", { className: "ml-auto text-[10px] text-muted-foreground", children: skill.category }))] }, skill.id));
                                                    }), filteredSkills.length === 0 && (_jsx("p", { className: "py-3 text-center text-[11px] text-muted-foreground", children: skillSearch ? "无匹配的 Skill" : "暂无可用 Skill" }))] }), _jsxs("div", { className: "mt-1 flex items-center justify-between text-[10px] text-muted-foreground", children: [_jsx("span", { children: "\u9009\u4E2D\u7684\u6280\u80FD\u5185\u5BB9\u5C06\u4F5C\u4E3A Agent Prompt \u524D\u7F00\u6CE8\u5165" }), skillSearch && (_jsxs("span", { className: "font-mono tabular-nums", children: [filteredSkills.length, "/", availableSkills.length] }))] })] })), _jsxs(FormGroup, { label: "Prompt", children: [_jsx("textarea", { disabled: readOnly, className: "flex min-h-[120px] w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", value: String((_d = data.prompt) !== null && _d !== void 0 ? _d : ""), onChange: (e) => update({ prompt: e.target.value }), placeholder: "\u5982\u7559\u7A7A\u5219\u9ED8\u8BA4\u4F7F\u7528 prev_output" }), _jsxs("div", { className: "mt-1 text-[10px] leading-relaxed text-muted-foreground", children: ["\u53EF\u7528\u53D8\u91CF\uFF1A", _jsx("span", { className: "text-emerald-600", children: "{prev_output}" }), " \u4E0A\u4E00\u8282\u70B9\u8F93\u51FA \u00B7 ", _jsx("span", { className: "text-emerald-600", children: "{item.title}" }), " \u5DE5\u4F5C\u9879\u6807\u9898 \u00B7 ", _jsx("span", { className: "text-emerald-600", children: "{item.description}" }), " \u63CF\u8FF0"] })] }), !isRemote && (_jsx(FormGroup, { label: "\u5DE5\u4F5C\u76EE\u5F55 (cwd)", children: _jsx(Input, { value: String((_e = data.cwd) !== null && _e !== void 0 ? _e : ""), disabled: readOnly, onChange: (e) => update({ cwd: e.target.value }), placeholder: "\u7559\u7A7A\u5219\u4F7F\u7528\u9879\u76EE\u6839\u8DEF\u5F84", className: "rounded-lg font-mono text-xs" }) })), _jsx(FormGroup, { label: "\u9AD8\u7EA7\u9009\u9879", children: _jsxs("label", { className: `flex items-start gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5 transition-colors ${readOnly
                                                ? "cursor-not-allowed opacity-60"
                                                : "cursor-pointer hover:bg-muted/40"}`, children: [_jsx("input", { type: "checkbox", className: "mt-0.5 h-3.5 w-3.5 accent-primary", checked: data.useWorktree !== false, disabled: readOnly, onChange: (e) => update({ useWorktree: e.target.checked }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "text-[12px] font-medium text-foreground", children: "\u542F\u7528\u5DE5\u4F5C\u533A\u9694\u79BB" }), _jsx("div", { className: "mt-0.5 text-[10px] leading-relaxed text-muted-foreground", children: "Agent \u5C06\u5728\u72EC\u7ACB\u7684 Git Worktree \u4E2D\u6267\u884C\uFF0C\u907F\u514D\u591A\u5DE5\u4F5C\u9879\u5E76\u884C\u51B2\u7A81" })] })] }) })] }));
                        })(), t === "approval" && (_jsxs(FormGroup, { label: "\u5BA1\u6279\u4EBA", children: [projectId && members.length > 0 ? (_jsx(ApproverPicker, { members: members, value: Array.isArray(data.approvers) ? data.approvers : [], disabled: readOnly, onChange: (next) => update({ approvers: next }) })) : (_jsx(Input, { value: Array.isArray(data.approvers) ? data.approvers.join(", ") : "", disabled: readOnly, onChange: (e) => update({
                                        approvers: e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter(Boolean),
                                    }), placeholder: "user1, user2", className: "rounded-lg" })), !projectId && (_jsx("div", { className: "mt-1 text-[10px] leading-relaxed text-muted-foreground", children: "\u9879\u76EE\u4E0A\u4E0B\u6587\u672A\u63D0\u4F9B\uFF0C\u8BF7\u4EE5\u9017\u53F7\u5206\u9694\u624B\u52A8\u8F93\u5165\u5BA1\u6279\u4EBA" }))] })), t === "condition" && (_jsxs(_Fragment, { children: [_jsx(FormGroup, { label: "\u5B57\u6BB5", children: _jsx(Input, { value: String((_d = data.field) !== null && _d !== void 0 ? _d : ""), disabled: readOnly, onChange: (e) => update({ field: e.target.value }), placeholder: "\u5982\uFF1Acontext.node_2.output", className: "rounded-lg font-mono text-xs" }) }), _jsx(FormGroup, { label: "\u64CD\u4F5C\u7B26", children: _jsx(Select, { options: OPERATOR_OPTIONS, value: String((_e = data.operator) !== null && _e !== void 0 ? _e : "eq"), disabled: readOnly, onChange: (e) => update({ operator: e.target.value }) }) }), _jsx(FormGroup, { label: "\u6BD4\u8F83\u503C", children: _jsx(Input, { value: String((_f = data.value) !== null && _f !== void 0 ? _f : ""), disabled: readOnly, onChange: (e) => update({ value: e.target.value }), placeholder: "\u6BD4\u8F83\u503C", className: "rounded-lg" }) })] })), t === "delay" && (_jsx(FormGroup, { label: "\u5EF6\u8FDF\u79D2\u6570", children: _jsx(Input, { type: "number", min: 0, value: String((_g = data.seconds) !== null && _g !== void 0 ? _g : 0), disabled: readOnly, onChange: (e) => update({ seconds: Number(e.target.value) || 0 }), className: "rounded-lg font-mono" }) })), t === "stage" && (_jsxs(_Fragment, { children: [_jsx(FormGroup, { label: "\u7C7B\u522B", children: _jsx(Select, { options: STAGE_CATEGORY_OPTIONS, value: String((_h = data.category) !== null && _h !== void 0 ? _h : "custom"), disabled: readOnly, onChange: (e) => update({ category: e.target.value }) }) }), _jsx("div", { className: "rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground", children: "STAGE \u8282\u70B9\u8868\u793A\u5DE5\u4F5C\u9879\u9636\u6BB5\uFF0C\u5728\u770B\u677F\u4E2D\u4F5C\u4E3A\u7EB5\u5217\u51FA\u73B0\u3002" })] })), t === "git_merge" && (_jsxs(_Fragment, { children: [_jsx(FormGroup, { label: "\u6E90\u5206\u652F", children: _jsx(Input, { value: String((_j = data.sourceBranch) !== null && _j !== void 0 ? _j : ""), disabled: readOnly, onChange: (e) => update({ sourceBranch: e.target.value }), placeholder: "\u7559\u7A7A\u5219\u81EA\u52A8\u4F7F\u7528\u5DE5\u4F5C\u9879\u5206\u652F", className: "rounded-lg font-mono text-xs" }) }), _jsx(FormGroup, { label: "\u76EE\u6807\u5206\u652F", children: _jsx(Input, { value: String((_k = data.targetBranch) !== null && _k !== void 0 ? _k : ""), disabled: readOnly, onChange: (e) => update({ targetBranch: e.target.value }), placeholder: "\u7559\u7A7A\u5219\u81EA\u52A8\u4F7F\u7528\u5DE5\u4F5C\u9879\u5206\u652F", className: "rounded-lg font-mono text-xs" }) }), _jsx(FormGroup, { label: "\u5408\u5E76\u7B56\u7565", children: _jsxs("select", { value: String((_l = data.mergeStrategy) !== null && _l !== void 0 ? _l : "merge"), disabled: readOnly, onChange: (e) => update({ mergeStrategy: e.target.value }), className: "w-full rounded-lg border border-input bg-background px-3 py-2 text-xs", children: [_jsx("option", { value: "merge", children: "Merge (\u4FDD\u7559\u63D0\u4EA4\u5386\u53F2)" }), _jsx("option", { value: "squash", children: "Squash (\u538B\u7F29\u4E3A\u5355\u6B21\u63D0\u4EA4)" }), _jsx("option", { value: "rebase", children: "Rebase (\u53D8\u57FA)" })] }) }), _jsx(FormGroup, { label: "\u51B2\u7A81\u5904\u7406", children: _jsxs("select", { value: String((_m = data.onConflict) !== null && _m !== void 0 ? _m : "fail"), disabled: readOnly, onChange: (e) => update({ onConflict: e.target.value }), className: "w-full rounded-lg border border-input bg-background px-3 py-2 text-xs", children: [_jsx("option", { value: "fail", children: "\u5931\u8D25\u5E76\u505C\u6B62" }), _jsx("option", { value: "manual", children: "\u7B49\u5F85\u624B\u52A8\u5904\u7406" })] }) }), _jsxs(FormGroup, { label: "\u9AD8\u7EA7\u9009\u9879", children: [_jsxs("label", { className: `flex items-start gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5 transition-colors ${readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40"}`, children: [_jsx("input", { type: "checkbox", className: "mt-0.5 h-3.5 w-3.5 accent-primary", checked: data.deleteSource === true, disabled: readOnly, onChange: (e) => update({ deleteSource: e.target.checked }) }), _jsx("div", { className: "min-w-0 flex-1", children: _jsx("div", { className: "text-[12px] font-medium text-foreground", children: "\u5408\u5E76\u540E\u5220\u9664\u6E90\u5206\u652F" }) })] }), _jsxs("label", { className: `mt-2 flex items-start gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5 transition-colors ${readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40"}`, children: [_jsx("input", { type: "checkbox", className: "mt-0.5 h-3.5 w-3.5 accent-primary", checked: data.autoPush === true, disabled: readOnly, onChange: (e) => update({ autoPush: e.target.checked }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "text-[12px] font-medium text-foreground", children: "\u5408\u5E76\u540E\u81EA\u52A8\u63A8\u9001" }), _jsx("div", { className: "mt-0.5 text-[10px] leading-relaxed text-muted-foreground", children: "\u5408\u5E76\u6210\u529F\u540E\u81EA\u52A8 push \u5230\u8FDC\u7A0B\u4ED3\u5E93\uFF08\u9700\u5728\u9879\u76EE\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u4ED3\u5E93\u5730\u5740\uFF09" })] })] })] })] })), (t === "parallel" || t === "parallel_join") && (_jsxs("div", { className: "rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground", children: [t === "parallel" ? "FORK" : "JOIN", " \u8282\u70B9\u4EC5\u63A7\u5236\u6D41\u7A0B\u7ED3\u6784\uFF0C \u901A\u8FC7\u8FDE\u7EBF\u51B3\u5B9A\u5206\u652F\u884C\u4E3A\u3002"] })), (t === "start" || t === "end") && (_jsxs("div", { className: "rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground", children: [t === "start" ? "START" : "END", " \u8282\u70B9\u4E3A\u5DE5\u4F5C\u6D41\u5165\u53E3/\u51FA\u53E3\u3002"] }))] }) }), !readOnly && onDelete && t !== "start" && (_jsx("div", { className: "border-t border-border/50 bg-muted/30 px-4 py-3", children: _jsx(Button, { variant: "destructive", size: "sm", className: "w-full", onClick: () => {
                        if (confirm("确定删除该节点？"))
                            onDelete(node.id);
                    }, children: "\u2715 \u5220\u9664\u8282\u70B9" }) }))] }));
}
function Header({ type }) {
    return (_jsxs("div", { className: "border-b border-border/50 px-4 py-3", children: [_jsx("div", { className: "text-[10px] font-medium text-muted-foreground", children: "\u5C5E\u6027\u9762\u677F" }), _jsxs("div", { className: "mt-0.5 flex items-center gap-2 text-sm font-semibold text-foreground", children: [_jsx("span", { children: "\u8282\u70B9\u5C5E\u6027" }), type && (_jsxs("span", { className: "ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-[1px] text-[10px] font-medium", children: [_jsx("span", { children: TYPE_GLYPH[type] }), _jsx("span", { children: TYPE_LABEL[type] })] }))] })] }));
}
function FormGroup({ label, children, }) {
    return (_jsxs("div", { className: "mb-3", children: [_jsx("div", { className: "mb-1.5 text-[10px] font-medium text-muted-foreground", children: label }), children] }));
}
function Field({ label, value, mono, }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "text-[9px] font-medium text-muted-foreground", children: label }), _jsx("div", { className: `mt-0.5 truncate text-foreground ${mono ? "font-mono text-[11px]" : "text-[12px]"}`, children: value || "—" })] }));
}
/** Agent 选择器：分组展示本地 / 远程 Agent，远程项携带状态色点。 */
function AgentSelect({ value, disabled, remoteAgents, onChange, }) {
    // 如果当前 value 是 a2a:* 但在远程列表中未找到（列表未加载完成或该 Agent 已下架），
    // 依然作为占位项加入，避免 native select 选中项丢失。
    const knownRemoteIds = new Set(remoteAgents.map((a) => a.id));
    const ghostRemote = isRemoteAgentId(value) && !knownRemoteIds.has(value) ? value : null;
    return (_jsxs("select", { value: value, disabled: disabled, onChange: (e) => onChange(e.target.value), className: "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", children: [_jsx("optgroup", { label: "\u672C\u5730 Agent", children: LOCAL_AGENT_OPTIONS.map((opt) => (_jsx("option", { value: opt.value, children: opt.label }, opt.value))) }), (remoteAgents.length > 0 || ghostRemote) && (_jsxs("optgroup", { label: "\u8FDC\u7A0B Agent", children: [remoteAgents.map((agent) => {
                        var _a;
                        const active = ((_a = agent.status) !== null && _a !== void 0 ? _a : "").toLowerCase() === "active";
                        // native <option> 不能渲染颜色节点，使用 ● 字符作为状态前缀
                        const dot = active ? "\u{1F7E2}" : "\u26AA";
                        const label = `${dot} ${agent.name || agent.id}`;
                        return (_jsx("option", { value: agent.id, children: label }, agent.id));
                    }), ghostRemote && (_jsx("option", { value: ghostRemote, children: `\u26AA ${ghostRemote}` }, ghostRemote))] }))] }));
}
/** 远程 Agent skills 只读展示区：帮助用户了解该 Agent 可以完成什么并编写 prompt。 */
function RemoteAgentSkills({ agent }) {
    if (!agent) {
        return (_jsx("div", { className: "rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground", children: "\u672A\u627E\u5230\u8BE5\u8FDC\u7A0B Agent\u3002\u8BF7\u786E\u8BA4\u5176\u662F\u5426\u4ECD\u5728\u6CE8\u518C\u8868\u4E2D\u4E14\u72B6\u6001\u4E3A active\u3002" }));
    }
    const skills = Array.isArray(agent.skills) ? agent.skills : [];
    if (skills.length === 0) {
        return (_jsx("div", { className: "rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground", children: "\u8BE5 Agent \u672A\u58F0\u660E skills\u3002\u53EF\u76F4\u63A5\u5728 Prompt \u4E2D\u63CF\u8FF0\u4EFB\u52A1\u3002" }));
    }
    return (_jsxs("div", { className: "space-y-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5", children: [agent.description && (_jsx("div", { className: "text-[10px] leading-relaxed text-muted-foreground", children: agent.description })), _jsx("ul", { className: "space-y-1.5", children: skills.map((skill, idx) => {
                    var _a;
                    const name = skill.name || skill.id || `skill-${idx + 1}`;
                    return (_jsxs("li", { className: "rounded-md bg-background/60 px-2 py-1.5", children: [_jsx("div", { className: "text-[11px] font-medium text-foreground", children: name }), skill.description && (_jsx("div", { className: "mt-0.5 text-[10px] leading-relaxed text-muted-foreground", children: skill.description })), Array.isArray(skill.tags) && skill.tags.length > 0 && (_jsx("div", { className: "mt-1 flex flex-wrap gap-1", children: skill.tags.map((tag) => (_jsx("span", { className: "rounded border border-border/50 bg-background px-1 py-[1px] text-[9px] text-muted-foreground", children: tag }, tag))) }))] }, (_a = skill.id) !== null && _a !== void 0 ? _a : `${name}-${idx}`));
                }) }), _jsx("div", { className: "pt-1 text-[10px] leading-relaxed text-muted-foreground", children: "\u63D0\u793A\uFF1A\u5728 Prompt \u4E2D\u660E\u786E\u63CF\u8FF0\u9700\u8981\u8C03\u7528\u7684\u80FD\u529B\uFF0C\u53EF\u63D0\u9AD8\u8FDC\u7A0B Agent \u5B8C\u6210\u4EFB\u52A1\u7684\u51C6\u786E\u7387\u3002" })] }));
}
function ApproverPicker({ members, value, disabled, onChange, }) {
    const selected = new Set(value);
    const toggle = (name) => {
        if (disabled)
            return;
        const next = new Set(selected);
        if (next.has(name))
            next.delete(name);
        else
            next.add(name);
        onChange(Array.from(next));
    };
    return (_jsxs("div", { className: "space-y-2", children: [_jsx("div", { className: "max-h-44 overflow-y-auto rounded-lg border border-input bg-background p-1", children: members.length === 0 ? (_jsx("div", { className: "px-2 py-3 text-center text-[11px] text-muted-foreground", children: "\u9879\u76EE\u6682\u65E0\u6210\u5458" })) : (members.map((m) => {
                    const name = m.display_name || m.username;
                    const checked = selected.has(name);
                    return (_jsxs("label", { className: `flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${checked
                            ? "bg-primary/10 text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`, children: [_jsx("input", { type: "checkbox", className: "h-3.5 w-3.5 accent-primary", checked: checked, disabled: disabled, onChange: () => toggle(name) }), _jsx("span", { className: "flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary", children: name.slice(0, 1) }), _jsx("span", { className: "flex-1 truncate", children: name })] }, m.id));
                })) }), value.length > 0 && (_jsxs("div", { className: "text-[10px] text-muted-foreground", children: ["\u5DF2\u9009 ", value.length, " \u4EBA\uFF1A", value.join("、")] }))] }));
}
//# sourceMappingURL=PropertyPanel.js.map