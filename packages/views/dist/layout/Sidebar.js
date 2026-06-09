"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@lark2codex/ui";
const NAV_ITEMS = [
    { label: "工作台", href: "/", icon: "🏠" },
    { label: "任务", href: "/tasks", icon: "📋" },
    { label: "Plan", href: "/plans", icon: "📝" },
    { label: "看板", href: "/kanban", icon: "📊" },
    { label: "工作流", href: "/workflows", icon: "🔄" },
    { label: "定时", href: "/schedules", icon: "⏰" },
    { label: "项目", href: "/projects", icon: "📁" },
    { label: "会话", href: "/sessions", icon: "💬" },
];
function isActive(pathname, href) {
    if (href === "/")
        return pathname === "/";
    return pathname.startsWith(href);
}
export function Sidebar({ open, onClose }) {
    const pathname = usePathname();
    return (_jsxs(_Fragment, { children: [open && (_jsx("div", { className: "fixed inset-0 z-40 bg-black/50 lg:hidden", onClick: onClose })), _jsxs("aside", { className: cn("fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 flex-col border-r bg-card transition-transform duration-200 lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full"), children: [_jsxs("div", { className: "flex h-14 items-center gap-2 border-b px-4", children: [_jsx("span", { className: "text-xl", children: "\uD83E\uDD16" }), _jsx("span", { className: "text-base font-bold tracking-tight", children: "Lark2Agent" })] }), _jsx("nav", { className: "flex-1 space-y-1 overflow-y-auto p-3", children: NAV_ITEMS.map((item) => (_jsxs(Link, { href: item.href, onClick: onClose, className: cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", isActive(pathname, item.href)
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"), children: [_jsx("span", { className: "text-base", children: item.icon }), _jsx("span", { children: item.label })] }, item.href))) }), _jsx("div", { className: "border-t p-3", children: _jsxs(Link, { href: "/settings", className: "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors", children: [_jsx("span", { className: "text-base", children: "\u2699\uFE0F" }), _jsx("span", { children: "\u8BBE\u7F6E" })] }) })] })] }));
}
//# sourceMappingURL=Sidebar.js.map