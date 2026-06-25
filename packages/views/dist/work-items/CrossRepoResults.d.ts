/**
 * 工作项跨仓库执行结果聚合视图。
 *
 * 仅当工作项关联了项目组（``group_id``）且后端已生成跨仓库 Plan 时才会
 * 渲染。每个仓库渲染为一张卡片，展示其状态、commit、diff 概要。
 */
interface CrossRepoResultsProps {
    workItemId: string;
    /** 是否为项目组工作项（无 group_id 时不发起请求，组件折叠不显示） */
    enabled?: boolean;
}
export declare function CrossRepoResults({ workItemId, enabled }: CrossRepoResultsProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=CrossRepoResults.d.ts.map