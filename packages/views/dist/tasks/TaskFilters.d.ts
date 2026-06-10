export interface TaskFiltersValue {
    status?: string;
    agent_id?: string;
    project?: string;
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