interface WorkItemCreateDialogProps {
    /**
     * 调用方传入的默认项目 id（项目组模式下可能被该组 primary 项目覆盖）。
     * 当 ``initialScopeValue`` 为 ``project:<id>`` 时与 id 应一致。
     */
    projectId: string;
    /**
     * 默认归属，与列表页筛选器同构。
     *
     * - ``"project:<id>"`` -> 默认选中具体项目
     * - ``"group:<id>"``   -> 默认选中具体项目组
     * - ``""`` / 缺省      -> 使用 ``projectId`` 作为单仓库默认
     */
    initialScopeValue?: string;
    onClose: () => void;
    onSuccess?: () => void;
}
export declare function WorkItemCreateDialog({ projectId, initialScopeValue, onClose, onSuccess, }: WorkItemCreateDialogProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=WorkItemCreateDialog.d.ts.map