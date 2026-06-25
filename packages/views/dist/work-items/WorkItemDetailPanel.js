"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button, Badge, Input, Select } from "@tide/ui";
import { useWorkItem, useWorkItemTransitions, useUpdateWorkItem, useDeleteWorkItem, useWorkflow, useVersions, useProjectMembers, useApprovals, useApproveApproval, useRejectApproval, parseApprovalDetail, useAddArtifact, useAuth, } from "@tide/core";
import { CrossRepoResults } from "./CrossRepoResults";
const PRIORITY_OPTIONS = [
    { value: "0", label: "无" },
    { value: "1", label: "低" },
    { value: "2", label: "中" },
    { value: "3", label: "高" },
    { value: "4", label: "紧急" },
];
function formatTime(iso) {
    if (!iso)
        return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    catch (_a) {
        return iso;
    }
}
/** 从 transition.output 中尝试解析 session_id（兼容 JSON 与文本两种格式） */
function extractSessionId(output) {
    if (!output)
        return null;
    try {
        const parsed = JSON.parse(output);
        if (parsed && typeof parsed === "object" && typeof parsed.session_id === "string") {
            return parsed.session_id;
        }
    }
    catch (_a) {
        // not JSON, fall through
    }
    const m = output.match(/session[_-]?id["'\s:=]+([0-9a-fA-F-]{8,})/);
    return m ? m[1] : null;
}
export function WorkItemDetailPanel({ itemId, onClose, }) {
    var _a, _b, _c;
    const { data: item, isLoading } = useWorkItem(itemId);
    const { data: transitions } = useWorkItemTransitions(itemId);
    const { data: workflow } = useWorkflow((item === null || item === void 0 ? void 0 : item.workflow_id) || "");
    const { data: versions } = useVersions(item === null || item === void 0 ? void 0 : item.project_id);
    const { data: membersData } = useProjectMembers(item === null || item === void 0 ? void 0 : item.project_id);
    const { user } = useAuth();
    const isViewer = (user === null || user === void 0 ? void 0 : user.role) === "viewer";
    const updateMutation = useUpdateWorkItem();
    const deleteMutation = useDeleteWorkItem();
    const nodeNameMap = useMemo(() => {
        var _a, _b, _c;
        const map = {};
        for (const n of (_b = (_a = workflow === null || workflow === void 0 ? void 0 : workflow.definition) === null || _a === void 0 ? void 0 : _a.nodes) !== null && _b !== void 0 ? _b : []) {
            const label = ((_c = n.data) === null || _c === void 0 ? void 0 : _c.label) || n.id;
            map[n.id] = label;
        }
        return map;
    }, [workflow]);
    const versionOptions = useMemo(() => {
        const opts = [
            { value: "", label: "未关联" },
        ];
        for (const v of versions !== null && versions !== void 0 ? versions : []) {
            const suffix = v.status === "released"
                ? " · 已发布"
                : v.status === "archived"
                    ? " · 已归档"
                    : "";
            opts.push({ value: v.id, label: `${v.name}${suffix}` });
        }
        // 兼容工作项已绑定但版本列表中不存在该版本的情况，避免回显成空
        if ((item === null || item === void 0 ? void 0 : item.version_id) && !opts.some((o) => o.value === item.version_id)) {
            opts.push({ value: item.version_id, label: item.version_id });
        }
        return opts;
    }, [versions, item === null || item === void 0 ? void 0 : item.version_id]);
    const assigneeOptions = useMemo(() => {
        var _a;
        const opts = [
            { value: "", label: "未分配" },
        ];
        for (const m of (_a = membersData === null || membersData === void 0 ? void 0 : membersData.members) !== null && _a !== void 0 ? _a : []) {
            const name = m.display_name || m.username;
            opts.push({ value: name, label: name });
        }
        // 兼容当前 assignee 不在成员列表中的情况，仍可回显
        if ((item === null || item === void 0 ? void 0 : item.assignee) && !opts.some((o) => o.value === item.assignee)) {
            opts.push({ value: item.assignee, label: item.assignee });
        }
        return opts;
    }, [membersData, item === null || item === void 0 ? void 0 : item.assignee]);
    const [editing, setEditing] = useState(false);
    const [editTitle, setEditTitle] = useState("");
    const [editDescription, setEditDescription] = useState("");
    const startEditing = () => {
        var _a;
        if (!item)
            return;
        setEditTitle(item.title);
        setEditDescription((_a = item.description) !== null && _a !== void 0 ? _a : "");
        setEditing(true);
    };
    const saveEdit = async () => {
        if (!item)
            return;
        await updateMutation.mutateAsync({
            id: item.id,
            data: {
                title: editTitle.trim() || item.title,
                description: editDescription.trim() || undefined,
            },
        });
        setEditing(false);
    };
    const handleDelete = async () => {
        if (!item)
            return;
        if (!confirm("确定删除该工作项？"))
            return;
        await deleteMutation.mutateAsync(item.id);
        onClose();
    };
    const handleFieldUpdate = (data) => {
        if (!item)
            return;
        updateMutation.mutate({ id: item.id, data });
    };
    if (isLoading || !item) {
        return (_jsx(PanelShell, { onClose: onClose, children: _jsx("div", { className: "py-12 text-center font-mono text-xs text-zinc-500", children: "\u25D0 LOADING\u2026" }) }));
    }
    const inlineSelectClass = "h-7 w-full rounded-md border border-border/50 bg-background px-2 py-0 text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";
    const fieldDisabled = updateMutation.isPending || isViewer;
    return (_jsx(PanelShell, { onClose: onClose, children: _jsxs("div", { className: "space-y-6", children: [editing ? (_jsxs("div", { className: "space-y-3", children: [_jsx(Input, { value: editTitle, onChange: (e) => setEditTitle(e.target.value), className: "h-11 rounded-lg border-0 bg-muted/50 text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0" }), _jsx("textarea", { value: editDescription, onChange: (e) => setEditDescription(e.target.value), rows: 4, className: "w-full rounded-lg border-0 bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring", placeholder: "\u63CF\u8FF0" }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { size: "sm", onClick: saveEdit, disabled: updateMutation.isPending, children: updateMutation.isPending ? "保存中…" : "保存" }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => setEditing(false), children: "\u53D6\u6D88" })] })] })) : (_jsxs("div", { children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsx("h2", { className: "flex-1 text-2xl font-semibold tracking-tight text-foreground", children: item.title }), _jsxs("div", { className: "flex shrink-0 items-center gap-1", children: [_jsx(Button, { variant: "ghost", size: "sm", className: "h-8 w-8 p-0 text-muted-foreground hover:text-foreground", onClick: startEditing, "aria-label": "\u7F16\u8F91", title: "\u7F16\u8F91", children: _jsx(Pencil, { className: "h-4 w-4" }) }), _jsx(Button, { variant: "ghost", size: "sm", className: "h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive", onClick: handleDelete, disabled: deleteMutation.isPending, "aria-label": "\u5220\u9664", title: "\u5220\u9664", children: _jsx(Trash2, { className: "h-4 w-4" }) })] })] }), item.description && (_jsx("p", { className: "mt-2 text-sm leading-relaxed text-muted-foreground", children: item.description }))] })), _jsxs("div", { className: "grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/50 bg-muted/30 p-4", children: [_jsx(MetaItem, { label: "\u4F18\u5148\u7EA7", children: _jsx(Select, { "aria-label": "\u4F18\u5148\u7EA7", value: String((_a = item.priority) !== null && _a !== void 0 ? _a : 0), onChange: (e) => handleFieldUpdate({ priority: Number(e.target.value) }), disabled: fieldDisabled, options: PRIORITY_OPTIONS, className: inlineSelectClass }) }), _jsx(MetaItem, { label: "\u8D1F\u8D23\u4EBA", children: _jsx(Select, { "aria-label": "\u8D1F\u8D23\u4EBA", value: (_b = item.assignee) !== null && _b !== void 0 ? _b : "", onChange: (e) => handleFieldUpdate({ assignee: e.target.value }), disabled: fieldDisabled, options: assigneeOptions, className: inlineSelectClass }) }), _jsx(MetaItem, { label: "\u7248\u672C", children: _jsx(Select, { "aria-label": "\u7248\u672C", value: (_c = item.version_id) !== null && _c !== void 0 ? _c : "", onChange: (e) => handleFieldUpdate({ version_id: e.target.value }), disabled: fieldDisabled, options: versionOptions, className: inlineSelectClass }) }), _jsx(MetaItem, { label: "\u6765\u6E90", children: _jsx(Badge, { variant: "outline", className: "text-[10px]", children: item.source_type }) }), _jsx(MetaItem, { label: "\u521B\u5EFA\u65F6\u95F4", children: _jsx("span", { className: "text-xs tabular-nums text-muted-foreground", children: formatTime(item.created_at) }) })] }), item.tags && item.tags.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground", children: "\u6807\u7B7E" }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: item.tags.map((tag) => (_jsx(Badge, { variant: "outline", className: "rounded-md border-border/60 text-xs", children: tag }, tag))) })] })), _jsx(WorkItemApprovalSection, { item: item }), _jsx(CrossRepoResults, { workItemId: item.id, enabled: !!item.group_id }), _jsx(WorkItemArtifactsSection, { item: item }), _jsxs("div", { children: [_jsx("div", { className: "mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground", children: "\u6D41\u8F6C\u5386\u53F2" }), transitions && transitions.length > 0 ? (_jsx("div", { className: "space-y-2", children: transitions.map((t) => {
                                var _a;
                                // 流转记录中可能包含关联任务（agent 节点会触发 task），
                                // 输出字段也可能内嵌 session_id；提取后渲染快捷链接。
                                const sessionId = extractSessionId(t.output);
                                return (_jsxs("div", { className: "rounded-lg border border-border/50 bg-card p-3 shadow-card transition-smooth hover:shadow-card-hover", children: [_jsxs("div", { className: "flex items-center gap-3 text-xs", children: [_jsx("span", { className: "rounded-md bg-muted/60 px-2 py-0.5 text-muted-foreground", title: (_a = t.from_node_id) !== null && _a !== void 0 ? _a : "—", children: t.from_node_id
                                                        ? nodeNameMap[t.from_node_id] || t.from_node_id
                                                        : "—" }), _jsx("span", { className: "text-muted-foreground/60", children: "\u2192" }), _jsx("span", { className: "rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary", title: t.to_node_id, children: nodeNameMap[t.to_node_id] || t.to_node_id }), _jsx("span", { className: "ml-auto text-[10px] tabular-nums text-muted-foreground", children: formatTime(t.created_at) })] }), (t.task_id || sessionId) && (_jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-3", children: [t.task_id && (_jsxs(Link, { href: `/tasks/${t.task_id}`, className: "text-primary text-xs hover:underline transition-smooth", children: ["\u2192 \u67E5\u770B\u4EFB\u52A1 ", t.task_id.slice(0, 8)] })), sessionId && (_jsxs(Link, { href: `/sessions/${sessionId}`, className: "text-primary text-xs hover:underline transition-smooth", children: ["\u2192 \u67E5\u770B\u4F1A\u8BDD ", sessionId.slice(0, 8)] }))] })), t.output && (_jsxs("details", { className: "mt-2", children: [_jsx("summary", { className: "cursor-pointer text-[11px] font-medium text-primary hover:text-primary/80", children: "\u67E5\u770B\u8F93\u51FA" }), _jsx("pre", { className: "mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/40 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100", children: t.output })] }))] }, t.id));
                            }) })) : (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u6D41\u8F6C\u8BB0\u5F55" }))] })] }) }));
}
function WorkItemArtifactsSection({ item }) {
    const { user } = useAuth();
    const isViewer = (user === null || user === void 0 ? void 0 : user.role) === "viewer";
    const addMutation = useAddArtifact();
    const [showForm, setShowForm] = useState(false);
    const [label, setLabel] = useState("");
    const [url, setUrl] = useState("");
    const [stage, setStage] = useState("");
    const artifacts = (() => {
        const meta = item.metadata;
        if (!meta || typeof meta !== "object")
            return [];
        const list = meta.artifacts;
        if (!Array.isArray(list))
            return [];
        return list;
    })();
    // 按 stage 分组
    const grouped = artifacts.reduce((acc, a) => {
        const key = a.stage || "";
        if (!acc[key])
            acc[key] = [];
        acc[key].push(a);
        return acc;
    }, {});
    const groupedEntries = Object.entries(grouped);
    const handleAdd = async () => {
        if (!label.trim() || !url.trim())
            return;
        await addMutation.mutateAsync({
            workItemId: item.id,
            data: { label: label.trim(), url: url.trim(), stage: stage.trim() },
        });
        setLabel("");
        setUrl("");
        setStage("");
        setShowForm(false);
    };
    return (_jsxs("div", { children: [_jsxs("div", { className: "mb-3 flex items-center justify-between", children: [_jsx("div", { className: "text-xs font-medium uppercase tracking-wider text-muted-foreground", children: "\u4EA7\u7269" }), !isViewer && (_jsx("button", { onClick: () => setShowForm(!showForm), className: "text-xs font-medium text-primary hover:text-primary/80 transition-smooth", children: showForm ? "取消" : "+ 添加" }))] }), showForm && (_jsxs("div", { className: "mb-3 space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3", children: [_jsx(Input, { value: label, onChange: (e) => setLabel(e.target.value), placeholder: "\u4EA7\u7269\u540D\u79F0", className: "h-8 text-sm" }), _jsx(Input, { value: url, onChange: (e) => setUrl(e.target.value), placeholder: "\u94FE\u63A5\u5730\u5740 (https://...)", className: "h-8 text-sm" }), _jsx(Input, { value: stage, onChange: (e) => setStage(e.target.value), placeholder: "\u9636\u6BB5\u540D\u79F0\uFF08\u53EF\u9009\uFF09", className: "h-8 text-sm" }), _jsx(Button, { size: "sm", onClick: handleAdd, disabled: !label.trim() || !url.trim() || addMutation.isPending, children: addMutation.isPending ? "添加中…" : "确认添加" })] })), groupedEntries.length > 0 ? (_jsx("div", { className: "space-y-3", children: groupedEntries.map(([stageKey, items]) => (_jsxs("div", { children: [stageKey && (_jsx("p", { className: "mb-1 text-[11px] font-medium text-muted-foreground", children: stageKey })), _jsx("div", { className: "space-y-1", children: items.map((artifact) => (_jsxs("div", { className: "group flex items-center gap-2 rounded-md px-2 py-1 transition-smooth hover:bg-muted/50", children: [_jsx("span", { className: "text-xs text-muted-foreground", children: "\u2022" }), _jsx("a", { href: artifact.url, target: "_blank", rel: "noopener noreferrer", className: "flex-1 truncate text-sm text-primary hover:underline", children: artifact.label })] }, artifact.id))) })] }, stageKey))) })) : (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-4 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u4EA7\u7269" }))] }));
}
function WorkItemApprovalSection({ item }) {
    var _a, _b, _c, _d;
    // 1. 拉取 workflow 以识别当前节点是否为审批节点（仅作为辅助判断、
    //    提供“节点名称”展示；workflow_id 为空时应跳过请求。
    const { data: workflow } = useWorkflow(item.workflow_id || "");
    const currentNode = (_b = (_a = workflow === null || workflow === void 0 ? void 0 : workflow.definition) === null || _a === void 0 ? void 0 : _a.nodes) === null || _b === void 0 ? void 0 : _b.find((n) => n.id === item.current_node_id);
    // 2. 拉取 pending 审批列表，筛选出当前工作项的审批
    const { data: approvalsData } = useApprovals({ status: "pending" });
    const approval = ((_c = approvalsData === null || approvalsData === void 0 ? void 0 : approvalsData.items) !== null && _c !== void 0 ? _c : []).find((a) => {
        const detail = parseApprovalDetail(a);
        return (a.type === "work_item_transition" && detail.work_item_id === item.id);
    });
    const approveMutation = useApproveApproval();
    const rejectMutation = useRejectApproval();
    const [comment, setComment] = useState("");
    const [rejectError, setRejectError] = useState(null);
    // 只要存在匹配的 pending 审批就展示入口。之前同时要求
    // “当前节点为 approval 类型”导致 workflow 定义节点 type 不一致时
    // 入口丢失。以是否存在实际的 pending approval 为唯一权威源。
    if (!approval) {
        return null;
    }
    const detail = parseApprovalDetail(approval);
    const reason = detail.reason || "";
    const isPending = approveMutation.isPending || rejectMutation.isPending;
    const isApprovalNode = (currentNode === null || currentNode === void 0 ? void 0 : currentNode.type) === "approval";
    const handleApprove = () => {
        setRejectError(null);
        approveMutation.mutate({
            id: approval.id,
            comment: comment.trim() || undefined,
        });
    };
    const handleReject = () => {
        if (!comment.trim()) {
            setRejectError("拒绝时请填写审批意见");
            return;
        }
        setRejectError(null);
        rejectMutation.mutate({
            id: approval.id,
            comment: comment.trim(),
        });
    };
    const error = approveMutation.error || rejectMutation.error;
    const nodeLabel = ((_d = currentNode === null || currentNode === void 0 ? void 0 : currentNode.data) === null || _d === void 0 ? void 0 : _d.label) ||
        item.current_node_id ||
        (isApprovalNode ? "审批节点" : "待人工确认");
    return (_jsx("div", { children: _jsxs("div", { className: "rounded-xl border border-amber-200/70 bg-amber-50/60 p-4 shadow-card", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800", children: [_jsx("span", { className: "flex h-2 w-2 animate-pulse rounded-full bg-amber-500" }), "\u5F85\u5BA1\u6279"] }), _jsx(Badge, { variant: "outline", className: "rounded-md border-amber-200 bg-background text-[10px] text-amber-800", children: nodeLabel })] }), reason && (_jsx("p", { className: "mt-3 rounded-lg border-l-2 border-amber-400 bg-background/70 px-3 py-2 text-xs text-foreground/80", children: reason })), _jsxs("div", { className: "mt-3", children: [_jsxs("label", { className: "mb-1 block text-[10px] font-medium uppercase tracking-wider text-amber-800/80", children: ["\u5BA1\u6279\u610F\u89C1", _jsx("span", { className: "ml-1 text-amber-700/70", children: "\uFF08\u62D2\u7EDD\u65F6\u5FC5\u586B\uFF09" })] }), _jsx("textarea", { value: comment, onChange: (e) => {
                                setComment(e.target.value);
                                if (rejectError)
                                    setRejectError(null);
                            }, rows: 2, placeholder: "\u8BF7\u8F93\u5165\u5BA1\u6279\u610F\u89C1\u2026", className: "w-full resize-none rounded-lg border border-amber-200/70 bg-background/80 px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400", disabled: isPending }), rejectError && (_jsx("p", { className: "mt-1 text-[11px] text-destructive", children: rejectError }))] }), _jsxs("div", { className: "mt-4 flex gap-2", children: [_jsx(Button, { size: "sm", className: "flex-1 bg-emerald-600 text-white shadow-card transition-smooth hover:bg-emerald-700 hover:shadow-card-hover", onClick: handleApprove, disabled: isPending, children: approveMutation.isPending ? "审批中…" : "✓ 通过" }), _jsx(Button, { size: "sm", variant: "outline", className: "flex-1 border-destructive/30 text-destructive transition-smooth hover:bg-destructive/10 hover:text-destructive", onClick: handleReject, disabled: isPending, children: rejectMutation.isPending ? "拒绝中…" : "✕ 拒绝" })] }), error && (_jsxs("p", { className: "mt-2 text-[11px] text-destructive", children: ["\u64CD\u4F5C\u5931\u8D25\uFF1A", String(error)] }))] }) }));
}
function PanelShell({ children, onClose, }) {
    return (_jsx("div", { className: "fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in-0", onClick: onClose, children: _jsxs("div", { className: "h-full w-full max-w-lg overflow-y-auto rounded-l-2xl border-l border-border/50 bg-card p-6 shadow-2xl animate-in slide-in-from-right-10", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "mb-6 flex items-center justify-between border-b border-border/40 pb-4", children: [_jsx("span", { className: "text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground", children: "\u5DE5\u4F5C\u9879\u8BE6\u60C5" }), _jsx("button", { onClick: onClose, "aria-label": "\u5173\u95ED", className: "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground", children: "\u2715" })] }), children] }) }));
}
function MetaItem({ label, children, }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "text-[10px] font-medium uppercase tracking-wider text-muted-foreground", children: label }), _jsx("div", { className: "mt-1", children: children })] }));
}
//# sourceMappingURL=WorkItemDetailPanel.js.map