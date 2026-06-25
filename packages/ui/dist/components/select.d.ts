import * as React from "react";
export interface SelectOption {
    label: string;
    value: string;
    /** 设置为 true 时该选项不可选中（例如分组占位） */
    disabled?: boolean;
}
export interface SelectOptionGroup {
    /** 分组标题，渲染为 <optgroup label="…"> */
    label: string;
    options: SelectOption[];
}
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    /** 顶层平铺选项（在所有分组之前渲染） */
    options: SelectOption[];
    /**
     * 可选的分组选项；存在时使用 <optgroup> 进行原生分组展示。
     * 与 ``options`` 并存：``options`` 先渲染，再依次渲染各 group。
     */
    groups?: SelectOptionGroup[];
}
declare const Select: React.ForwardRefExoticComponent<SelectProps & React.RefAttributes<HTMLSelectElement>>;
export { Select };
//# sourceMappingURL=select.d.ts.map