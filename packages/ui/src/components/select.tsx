import * as React from "react";
import { cn } from "../lib/utils";

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

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, groups, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  }
);
Select.displayName = "Select";

export { Select };
