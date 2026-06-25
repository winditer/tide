"use client";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Toast, ToastClose, ToastDescription, ToastTitle, ToastViewport, } from "./toast";
import { useToast } from "../hooks/use-toast";
export function Toaster() {
    const { toasts } = useToast();
    return (_jsxs(_Fragment, { children: [toasts.map((_a) => {
                var { id, title, description, action } = _a, props = __rest(_a, ["id", "title", "description", "action"]);
                return (_jsxs(Toast, Object.assign({}, props, { children: [_jsxs("div", { className: "grid gap-1", children: [title && _jsx(ToastTitle, { children: title }), description && _jsx(ToastDescription, { children: description })] }), action, _jsx(ToastClose, {})] }), id));
            }), _jsx(ToastViewport, {})] }));
}
//# sourceMappingURL=toaster.js.map