import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const ToastViewport: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLOListElement> & React.RefAttributes<HTMLOListElement>>;
declare const toastVariants: (props?: ({
    variant?: "default" | "destructive" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export interface ToastProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof toastVariants> {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}
declare const Toast: React.ForwardRefExoticComponent<ToastProps & React.RefAttributes<HTMLDivElement>>;
declare const ToastAction: React.ForwardRefExoticComponent<React.ButtonHTMLAttributes<HTMLButtonElement> & React.RefAttributes<HTMLButtonElement>>;
declare const ToastClose: React.ForwardRefExoticComponent<React.ButtonHTMLAttributes<HTMLButtonElement> & React.RefAttributes<HTMLButtonElement>>;
declare const ToastTitle: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;
declare const ToastDescription: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;
export { ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose, ToastAction, toastVariants, };
//# sourceMappingURL=toast.d.ts.map