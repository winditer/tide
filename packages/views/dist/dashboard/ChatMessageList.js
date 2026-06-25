"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { SimpleMarkdown } from "../shared/SimpleMarkdown";
function formatTime(iso) {
    if (!iso)
        return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
}
export function ChatMessageList({ messages, emptyHint, onApprove, onReject }) {
    const scrollRef = useRef(null);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el)
            return;
        el.scrollTop = el.scrollHeight;
    }, [messages]);
    if (messages.length === 0) {
        return (_jsx("div", { ref: scrollRef, className: "flex h-full items-center justify-center px-4 py-6", children: _jsxs("div", { className: "max-w-[260px] text-center", children: [_jsx("div", { className: "mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "22", height: "22", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }) }) }), _jsx("div", { className: "text-xs text-muted-foreground", children: "\u6682\u65E0\u5BF9\u8BDD" }), _jsx("div", { className: "mt-1 text-sm text-foreground", children: emptyHint || "输入消息开启对话" })] }) }));
    }
    return (_jsx("div", { ref: scrollRef, className: "flex h-full flex-col gap-4 overflow-y-auto px-4 py-4", children: messages.map((msg) => (_jsx(MessageBubble, { message: msg, onApprove: onApprove, onReject: onReject }, msg.id))) }));
}
function MessageBubble({ message, onApprove, onReject }) {
    var _a, _b, _c;
    const isUser = message.role === "user";
    const isPendingOrRunning = message.status === "pending" || message.status === "running";
    const isFailed = message.status === "failed";
    const hasApprovalPending = ((_a = message.interactive) === null || _a === void 0 ? void 0 : _a.type) === "approval" &&
        message.interactive.status === "pending";
    const isApprovalResolved = ((_b = message.interactive) === null || _b === void 0 ? void 0 : _b.type) === "approval" &&
        (message.interactive.status === "approved" ||
            message.interactive.status === "rejected");
    const [approvalComment, setApprovalComment] = useState("");
    const [approvalError, setApprovalError] = useState(null);
    const handleApproveClick = () => {
        var _a;
        setApprovalError(null);
        const id = (_a = message.interactive) === null || _a === void 0 ? void 0 : _a.approvalId;
        if (!id)
            return;
        onApprove === null || onApprove === void 0 ? void 0 : onApprove(id, approvalComment.trim() || undefined);
    };
    const handleRejectClick = () => {
        var _a;
        const id = (_a = message.interactive) === null || _a === void 0 ? void 0 : _a.approvalId;
        if (!id)
            return;
        if (!approvalComment.trim()) {
            setApprovalError("拒绝时请填写审批意见");
            return;
        }
        setApprovalError(null);
        onReject === null || onReject === void 0 ? void 0 : onReject(id, approvalComment.trim());
    };
    if (isUser) {
        return (_jsxs("div", { className: "flex flex-col items-end", children: [_jsx("div", { className: "max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm leading-relaxed text-primary-foreground shadow-sm", children: _jsx("pre", { className: "whitespace-pre-wrap break-words font-sans", children: message.content }) }), _jsx("div", { className: "mt-1 text-xs text-muted-foreground", children: formatTime(message.timestamp) })] }));
    }
    return (_jsxs("div", { className: "flex flex-col items-start", children: [_jsxs("div", { className: "max-w-[80%] rounded-2xl rounded-bl-md border px-4 py-2 text-sm leading-relaxed text-foreground shadow-sm " +
                    (isFailed
                        ? "border-destructive/40 bg-destructive/5"
                        : hasApprovalPending
                            ? "border-amber-300/60 bg-amber-50"
                            : isPendingOrRunning
                                ? "border-border/50 bg-card"
                                : "border-border/50 bg-card"), children: [isPendingOrRunning && !message.content ? (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" }), _jsx("span", { className: "text-xs text-muted-foreground", children: "\u6267\u884C\u4E2D\u2026" })] })) : (_jsx(SimpleMarkdown, { source: message.content || "", variant: "compact", className: "break-words text-sm leading-6" })), hasApprovalPending && ((_c = message.interactive) === null || _c === void 0 ? void 0 : _c.approvalId) && (_jsxs("div", { className: "mt-2 space-y-2 border-t border-amber-200/60 pt-2", children: [_jsx("textarea", { value: approvalComment, onChange: (e) => {
                                    setApprovalComment(e.target.value);
                                    if (approvalError)
                                        setApprovalError(null);
                                }, rows: 2, placeholder: "\u5BA1\u6279\u610F\u89C1\uFF08\u62D2\u7EDD\u65F6\u5FC5\u586B\uFF09\u2026", className: "w-full resize-none rounded-md border border-amber-200/70 bg-white/80 px-2 py-1 text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400" }), approvalError && (_jsx("p", { className: "text-[11px] text-destructive", children: approvalError })), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: handleApproveClick, className: "rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-600", children: "\u901A\u8FC7" }), _jsx("button", { type: "button", onClick: handleRejectClick, className: "rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90", children: "\u62D2\u7EDD" })] })] })), isApprovalResolved && (_jsx("div", { className: "mt-2 border-t border-border/50 pt-2", children: _jsx("span", { className: "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium " +
                                (message.interactive.status === "approved"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-destructive/10 text-destructive"), children: message.interactive.status === "approved"
                                ? "✓ 已通过"
                                : "✕ 已拒绝" }) }))] }), _jsxs("div", { className: "mt-1 flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { children: formatTime(message.timestamp) }), message.status && (_jsx("span", { className: "rounded-md px-1.5 py-px text-[10px] font-medium " +
                            (message.status === "completed"
                                ? "bg-emerald-50 text-emerald-700"
                                : message.status === "failed"
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-muted text-muted-foreground"), children: message.status === "completed"
                            ? "完成"
                            : message.status === "failed"
                                ? "失败"
                                : message.status === "running"
                                    ? "运行中"
                                    : "等待中" }))] })] }));
}
//# sourceMappingURL=ChatMessageList.js.map