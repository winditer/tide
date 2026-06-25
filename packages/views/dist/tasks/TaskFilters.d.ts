export interface TaskFiltersValue {
    status?: string;
    agent_id?: string;
    /** 项目 cwd（与 group_id 互斥） */
    project?: string;
    /** 项目组 id（与 project 互斥） */
    group_id?: string;
    session_id?: string;
    created_after?: string;
    created_before?: string;
}
interface TaskFiltersProps {
    value: TaskFiltersValue;
    onChange: (value: TaskFiltersValue) => void;
    onReset: () => void;
}
export declare function TaskFilters({ value, onChange, onReset }: TaskFiltersProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=TaskFilters.d.ts.map