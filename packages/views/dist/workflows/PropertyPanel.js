"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, Input, Select } from "@lark2codex/ui";
const TYPE_LABEL = {
    start: "起始",
    end: "终止",
    agent: "Agent",
    approval: "审批",
    condition: "条件",
    parallel: "并行分发",
    parallel_join: "并行汇合",
    delay: "延时",
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
export function PropertyPanel({ node, onUpdate, onDelete, readOnly, }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!node) {
        return (_jsxs("div", { className: "flex h-full w-[300px] flex-col border-l-2 border-zinc-900 bg-white", children: [_jsx(Header, { type: null }), _jsxs("div", { className: "flex flex-1 flex-col items-center justify-center px-6 text-center", children: [_jsx("div", { className: "mb-2 font-mono text-[10px] tracking-[0.25em] text-zinc-400", children: "\u25C7 NO SELECTION" }), _jsx("div", { className: "text-xs text-zinc-500", children: "\u70B9\u51FB\u753B\u5E03\u4E2D\u7684\u8282\u70B9\u67E5\u770B\u4E0E\u7F16\u8F91\u5C5E\u6027" })] })] }));
    }
    const t = node.type;
    const data = (_a = node.data) !== null && _a !== void 0 ? _a : {};
    const update = (patch) => onUpdate(node.id, Object.assign(Object.assign({}, data), patch));
    return (_jsxs("div", { className: "flex h-full w-[300px] flex-col border-l-2 border-zinc-900 bg-white", children: [_jsx(Header, { type: t }), _jsxs("div", { className: "border-b border-dashed border-zinc-300 px-4 py-3", children: [_jsx(Field, { label: "ID", mono: true, value: node.id }), _jsxs("div", { className: "mt-2 grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "POS\u00B7X", mono: true, value: String(Math.round(node.position.x)) }), _jsx(Field, { label: "POS\u00B7Y", mono: true, value: String(Math.round(node.position.y)) })] })] }), _jsxs("div", { className: "flex-1 overflow-y-auto px-4 py-3", children: [_jsx(FormGroup, { label: "LABEL", children: _jsx(Input, { value: String((_b = data.label) !== null && _b !== void 0 ? _b : ""), disabled: readOnly, onChange: (e) => update({ label: e.target.value }), placeholder: "\u8282\u70B9\u540D\u79F0" }) }), t === "agent" && (_jsxs(_Fragment, { children: [_jsx(FormGroup, { label: "MODEL", children: _jsx(Input, { value: String((_c = data.model) !== null && _c !== void 0 ? _c : ""), disabled: readOnly, onChange: (e) => update({ model: e.target.value }), placeholder: "\u5982\uFF1Agpt-4 / claude-3.5-sonnet" }) }), _jsx(FormGroup, { label: "AGENT_ID", children: _jsx(Input, { value: String((_d = data.agent_id) !== null && _d !== void 0 ? _d : ""), disabled: readOnly, onChange: (e) => update({ agent_id: e.target.value }), placeholder: "\u53EF\u9009\uFF1AAgent \u6807\u8BC6" }) }), _jsx(FormGroup, { label: "PROMPT", children: _jsx("textarea", { disabled: readOnly, className: "flex min-h-[120px] w-full rounded-none border-2 border-zinc-900 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-900 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 disabled:opacity-50", value: String((_e = data.prompt) !== null && _e !== void 0 ? _e : ""), onChange: (e) => update({ prompt: e.target.value }), placeholder: "\u53D1\u9001\u7ED9 Agent \u7684\u63D0\u793A\u8BCD\u2026" }) })] })), t === "approval" && (_jsx(FormGroup, { label: "APPROVERS (COMMA-SEPARATED)", children: _jsx(Input, { value: Array.isArray(data.approvers) ? data.approvers.join(", ") : "", disabled: readOnly, onChange: (e) => update({
                                approvers: e.target.value
                                    .split(",")
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                            }), placeholder: "user1, user2" }) })), t === "condition" && (_jsxs(_Fragment, { children: [_jsx(FormGroup, { label: "FIELD", children: _jsx(Input, { value: String((_f = data.field) !== null && _f !== void 0 ? _f : ""), disabled: readOnly, onChange: (e) => update({ field: e.target.value }), placeholder: "\u5982\uFF1Acontext.node_2.output", className: "font-mono text-xs" }) }), _jsx(FormGroup, { label: "OPERATOR", children: _jsx(Select, { options: OPERATOR_OPTIONS, value: String((_g = data.operator) !== null && _g !== void 0 ? _g : "eq"), disabled: readOnly, onChange: (e) => update({ operator: e.target.value }) }) }), _jsx(FormGroup, { label: "VALUE", children: _jsx(Input, { value: String((_h = data.value) !== null && _h !== void 0 ? _h : ""), disabled: readOnly, onChange: (e) => update({ value: e.target.value }), placeholder: "\u6BD4\u8F83\u503C" }) })] })), t === "delay" && (_jsx(FormGroup, { label: "SECONDS", children: _jsx(Input, { type: "number", min: 0, value: String((_j = data.seconds) !== null && _j !== void 0 ? _j : 0), disabled: readOnly, onChange: (e) => update({ seconds: Number(e.target.value) || 0 }), className: "font-mono" }) })), (t === "parallel" || t === "parallel_join") && (_jsxs("div", { className: "rounded-none border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[10px] leading-relaxed text-zinc-500", children: ["\u25C7 ", t === "parallel" ? "FORK" : "JOIN", " \u8282\u70B9\u4EC5\u63A7\u5236\u6D41\u7A0B\u7ED3\u6784\uFF0C \u901A\u8FC7\u8FDE\u7EBF\u51B3\u5B9A\u5206\u652F\u884C\u4E3A\u3002"] })), (t === "start" || t === "end") && (_jsxs("div", { className: "rounded-none border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[10px] leading-relaxed text-zinc-500", children: ["\u25C7 ", t === "start" ? "START" : "END", " \u8282\u70B9\u4E3A\u5DE5\u4F5C\u6D41\u5165\u53E3/\u51FA\u53E3\u3002"] }))] }), !readOnly && onDelete && t !== "start" && (_jsx("div", { className: "border-t-2 border-zinc-900 bg-zinc-50 px-4 py-3", children: _jsx(Button, { variant: "destructive", size: "sm", className: "w-full", onClick: () => {
                        if (confirm("确定删除该节点？"))
                            onDelete(node.id);
                    }, children: "\u2715 \u5220\u9664\u8282\u70B9" }) }))] }));
}
function Header({ type }) {
    return (_jsxs("div", { className: "border-b-2 border-zinc-900 bg-zinc-950 px-4 py-3 text-white", children: [_jsx("div", { className: "font-mono text-[10px] tracking-[0.3em] text-zinc-400", children: "INSPECT" }), _jsxs("div", { className: "mt-0.5 flex items-center gap-2 font-mono text-[13px] font-bold tracking-[0.2em]", children: [_jsx("span", { children: "\u25F4" }), _jsx("span", { children: "PROPERTY" }), type && (_jsxs("span", { className: "ml-auto inline-flex items-center gap-1 border border-zinc-700 bg-zinc-900 px-1.5 py-[1px] text-[10px] tracking-widest", children: [_jsx("span", { children: TYPE_GLYPH[type] }), _jsx("span", { children: TYPE_LABEL[type] })] }))] })] }));
}
function FormGroup({ label, children, }) {
    return (_jsxs("div", { className: "mb-3", children: [_jsx("div", { className: "mb-1.5 font-mono text-[10px] tracking-[0.2em] text-zinc-500", children: label }), children] }));
}
function Field({ label, value, mono, }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "font-mono text-[9px] tracking-[0.2em] text-zinc-500", children: label }), _jsx("div", { className: `mt-0.5 truncate text-zinc-900 ${mono ? "font-mono text-[11px]" : "text-[12px]"}`, children: value || "—" })] }));
}
//# sourceMappingURL=PropertyPanel.js.map