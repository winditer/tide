import * as React from "react";
export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "secondary" | "destructive" | "outline" | "success";
}
declare function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element;
export { Badge };
//# sourceMappingURL=badge.d.ts.map