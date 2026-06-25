interface PlanCreateFormProps {
    onSuccess?: (planId: string) => void;
    /**
     * 默认归属，与列表页/工作项创建对话框统一编码：
     * - "project:<id>" → 默认选中具体项目
     * - "group:<id>"   → 默认选中具体项目组
     */
    initialScopeValue?: string;
}
export declare function PlanCreateForm({ onSuccess, initialScopeValue, }: PlanCreateFormProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PlanCreateForm.d.ts.map