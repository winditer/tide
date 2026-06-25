"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, Settings, ChevronsLeft, ChevronsRight, LogOut, UserRound, ShieldCheck, } from "lucide-react";
import { ConnectionStatus, Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, } from "@tide/ui";
import { useWs, useAuth } from "@tide/core";
export function Header({ onMenuClick, collapsed = false, onToggleCollapse }) {
    const { status } = useWs();
    return (_jsxs("header", { className: "glass sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-border/50 px-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "lg:hidden", onClick: onMenuClick, "aria-label": "\u6253\u5F00\u5BFC\u822A", children: _jsx(Menu, { className: "h-5 w-5", strokeWidth: 2 }) }), onToggleCollapse && (_jsx("button", { type: "button", onClick: onToggleCollapse, title: collapsed ? "展开侧边栏" : "收起侧边栏", "aria-label": collapsed ? "展开侧边栏" : "收起侧边栏", className: "hidden lg:flex w-8 h-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth", children: collapsed ? (_jsx(ChevronsRight, { className: "h-4 w-4", strokeWidth: 2 })) : (_jsx(ChevronsLeft, { className: "h-4 w-4", strokeWidth: 2 })) })), _jsx("span", { className: "ml-1 text-sm font-semibold tracking-tight lg:hidden", children: "Tide" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(ConnectionStatus, { status: status }), _jsx("div", { className: "hidden h-5 w-px bg-border/60 lg:block" }), _jsx(Link, { href: "/settings", className: "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-accent hover:text-foreground", "aria-label": "\u8BBE\u7F6E", children: _jsx(Settings, { className: "h-[18px] w-[18px]", strokeWidth: 2 }) }), _jsx(UserMenu, {})] })] }));
}
/**
 * Header user dropdown.
 *
 * Shows the current display name + role with a small avatar disc; opens a
 * menu containing profile shortcut and a logout action. When TIDE_REQUIRE_AUTH
 * is off and the user hasn't logged in, surfaces a "登录" entry instead.
 */
function UserMenu() {
    const router = useRouter();
    const { user, isAuthenticated, authRequired, logout, hydrated } = useAuth();
    // Avoid SSR/CSR flicker before hydration
    if (!hydrated) {
        return _jsx("div", { className: "h-8 w-24 rounded-md bg-muted/40", "aria-hidden": true });
    }
    if (!isAuthenticated) {
        return (_jsxs(Link, { href: "/auth/login", className: "inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background px-3 text-xs font-medium text-foreground/80 transition-smooth hover:border-primary hover:text-primary", children: [_jsx(UserRound, { className: "h-3.5 w-3.5", strokeWidth: 2 }), authRequired ? "登录" : "未登录"] }));
    }
    const display = (user === null || user === void 0 ? void 0 : user.display_name) || (user === null || user === void 0 ? void 0 : user.username) || "用户";
    const initial = display.trim().charAt(0).toUpperCase() || "U";
    const role = (user === null || user === void 0 ? void 0 : user.role) || "member";
    const handleLogout = async () => {
        await logout();
        if (authRequired) {
            router.replace("/auth/login");
        }
        else {
            router.refresh();
        }
    };
    return (_jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsxs("button", { type: "button", className: "group inline-flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background pl-1 pr-3 transition-smooth hover:border-primary/50 hover:bg-accent", "aria-label": "\u7528\u6237\u83DC\u5355", children: [_jsx("span", { className: "grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-primary text-[11px] font-semibold text-primary-foreground", "aria-hidden": true, children: (user === null || user === void 0 ? void 0 : user.avatar_url) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            _jsx("img", { src: user.avatar_url, alt: "", className: "h-full w-full object-cover" })) : (initial) }), _jsx("span", { className: "hidden text-xs font-medium text-foreground sm:inline", children: display })] }) }), _jsxs(DropdownMenuContent, { align: "end", sideOffset: 6, className: "w-60", children: [_jsxs(DropdownMenuLabel, { className: "flex flex-col gap-1", children: [_jsx("span", { className: "text-sm font-semibold leading-tight", children: display }), _jsxs("span", { className: "text-xs font-normal text-muted-foreground", children: ["@", user === null || user === void 0 ? void 0 : user.username] }), _jsxs("span", { className: "mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-primary", children: [_jsx(ShieldCheck, { className: "h-3 w-3", strokeWidth: 2.2 }), role] })] }), _jsx(DropdownMenuSeparator, {}), _jsxs(DropdownMenuItem, { onSelect: () => router.push("/settings"), children: [_jsx(Settings, { className: "mr-2 h-4 w-4", strokeWidth: 2 }), " \u8BBE\u7F6E"] }), _jsxs(DropdownMenuItem, { onSelect: (e) => {
                            e.preventDefault();
                            void handleLogout();
                        }, className: "text-destructive focus:text-destructive", children: [_jsx(LogOut, { className: "mr-2 h-4 w-4", strokeWidth: 2 }), " \u767B\u51FA"] })] })] }));
}
//# sourceMappingURL=Header.js.map