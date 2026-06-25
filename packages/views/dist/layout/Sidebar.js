"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListTodo, FolderKanban, Workflow, Target, Columns3, Clock, Layers, MessageSquare, Settings, } from "lucide-react";
import { cn } from "@tide/ui";
const NAV_GROUPS = [
    {
        title: "总览",
        items: [
            { label: "工作台", href: "/", icon: LayoutDashboard },
            { label: "看板", href: "/kanban", icon: Columns3 },
        ],
    },
    {
        title: "工作",
        items: [
            { label: "项目", href: "/projects", icon: FolderKanban },
            { label: "任务", href: "/tasks", icon: ListTodo },
            { label: "工作项", href: "/work-items", icon: Layers },
            { label: "计划", href: "/plans", icon: Target },
        ],
    },
    {
        title: "自动化",
        items: [
            { label: "工作流", href: "/workflows", icon: Workflow },
            { label: "定时", href: "/schedules", icon: Clock },
            { label: "会话", href: "/sessions", icon: MessageSquare },
        ],
    },
];
function isActive(pathname, href) {
    if (href === "/")
        return pathname === "/";
    return pathname.startsWith(href);
}
export function Sidebar({ open, onClose, collapsed = false, onToggleCollapse, showSettings = true }) {
    const pathname = usePathname();
    return (_jsxs(_Fragment, { children: [open && (_jsx("div", { className: "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden", onClick: onClose })), _jsxs("aside", { className: cn("fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-white/10 bg-[hsl(224_71%_4%)] text-[hsl(220_14%_96%)] transition-all duration-200 lg:static lg:translate-x-0", collapsed ? "w-56 lg:w-16" : "w-60", open ? "translate-x-0" : "-translate-x-full"), children: [_jsx("div", { className: cn("flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-5", collapsed && "lg:h-auto lg:flex-col lg:items-center lg:justify-center lg:gap-2 lg:px-0 lg:py-3"), children: _jsxs("div", { className: "flex min-w-0 items-center gap-2.5", children: [_jsx("div", { className: "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[hsl(238_76%_62%)] to-[hsl(238_76%_42%)] shadow-[0_0_12px_hsl(238_76%_62%/0.4)]", children: _jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "white", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M2 12c2-3 6-3 8 0s6 3 8 0 6-3 4 0" }), _jsx("path", { d: "M2 18c2-3 6-3 8 0s6 3 8 0 6-3 4 0" })] }) }), _jsx("span", { className: cn("truncate text-[15px] font-semibold tracking-tight text-white", collapsed && "lg:hidden"), children: "Tide" })] }) }), _jsx("nav", { className: "flex-1 overflow-y-auto px-3 py-4", children: NAV_GROUPS.map((group, idx) => (_jsxs("div", { className: cn(idx > 0 && "mt-5"), children: [_jsx("div", { className: cn("mb-2 px-3 text-xs font-medium uppercase tracking-wider text-white/40", collapsed && "lg:hidden"), children: group.title }), idx > 0 && collapsed && (_jsx("div", { className: "hidden lg:block mx-3 mb-2 border-t border-white/10" })), _jsx("div", { className: "space-y-0.5", children: group.items.map((item) => {
                                        const active = isActive(pathname, item.href);
                                        const Icon = item.icon;
                                        return (_jsxs(Link, { href: item.href, onClick: onClose, title: collapsed ? item.label : undefined, className: cn("group relative flex items-center gap-3 rounded-md py-2 text-sm transition-smooth", collapsed ? "px-3 lg:justify-center lg:px-0" : "px-3", active
                                                ? "bg-white/15 font-medium text-white"
                                                : "text-white/70 hover:bg-white/10 hover:text-white"), children: [active && (_jsx("span", { "aria-hidden": true, className: "absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-[hsl(238_76%_62%)]" })), _jsx(Icon, { className: cn("h-4 w-4 shrink-0 transition-smooth", active ? "text-[hsl(238_76%_72%)]" : "text-white/60 group-hover:text-white"), strokeWidth: 2 }), _jsx("span", { className: cn("truncate", collapsed && "lg:hidden"), children: item.label })] }, item.href));
                                    }) })] }, group.title))) }), _jsx("div", { className: "shrink-0 space-y-0.5 border-t border-white/10 p-3", children: showSettings && (_jsxs(Link, { href: "/settings", title: collapsed ? "设置" : undefined, className: cn("group relative flex items-center gap-3 rounded-md py-2 text-sm text-white/70 transition-smooth hover:bg-white/10 hover:text-white", collapsed ? "px-3 lg:justify-center lg:px-0" : "px-3", isActive(pathname, "/settings") && "bg-white/15 font-medium text-white"), children: [isActive(pathname, "/settings") && (_jsx("span", { "aria-hidden": true, className: "absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-[hsl(238_76%_62%)]" })), _jsx(Settings, { className: "h-4 w-4 shrink-0 text-white/60 group-hover:text-white", strokeWidth: 2 }), _jsx("span", { className: cn(collapsed && "lg:hidden"), children: "\u8BBE\u7F6E" })] })) })] })] }));
}
//# sourceMappingURL=Sidebar.js.map