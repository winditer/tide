import * as React from "react";
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    options: {
        label: string;
        value: string;
    }[];
}
declare const Select: React.ForwardRefExoticComponent<SelectProps & React.RefAttributes<HTMLSelectElement>>;
export { Select };
//# sourceMappingURL=select.d.ts.map