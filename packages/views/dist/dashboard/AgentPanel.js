"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Card, CardContent, CardHeader, CardTitle } from "@tide/ui";
import { useAgents } from "@tide/core";
export function AgentPanel() {
    var _a;
    const { data, isLoading, isError } = useAgents();
    const agents = (_a = data === null || data === void 0 ? void 0 : data.agents) !== null && _a !== void 0 ? _a : [];
    return (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { className: "text-base", children: "Agent \u72B6\u6001" }) }), _jsx(CardContent, { children: isLoading ? (_jsx("div", { className: "py-6 text-center text-sm text-muted-foreground", children: "\u52A0\u8F7D\u4E2D..." })) : isError ? (_jsx("div", { className: "py-6 text-center text-sm text-destructive", children: "\u52A0\u8F7D\u5931\u8D25" })) : agents.length === 0 ? (_jsx("div", { className: "py-6 text-center text-sm text-muted-foreground", children: "\u6682\u65E0 Agent" })) : (_jsx("div", { className: "space-y-3", children: agents.map((agent) => (_jsxs("div", { className: "flex items-center justify-between rounded-md px-2 py-1.5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `inline-block h-2.5 w-2.5 rounded-full ${agent.available ? "bg-green-500" : "bg-gray-300"}` }), _jsx("span", { className: "text-sm font-medium", children: agent.name })] }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [agent.running_tasks > 0 && (_jsxs("span", { className: "rounded bg-blue-100 px-1.5 py-0.5 text-blue-700", children: [agent.running_tasks, " \u8FD0\u884C"] })), agent.queued_tasks > 0 && (_jsxs("span", { className: "rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-700", children: [agent.queued_tasks, " \u6392\u961F"] })), agent.running_tasks === 0 && agent.queued_tasks === 0 && (_jsx("span", { children: "\u7A7A\u95F2" }))] })] }, agent.id))) })) })] }));
}
//# sourceMappingURL=AgentPanel.js.map