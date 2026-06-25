import { type ProjectGroupSummary, type ProjectInfo } from "@tide/core";
export interface ProjectGroupListProps {
    /** 用于创建对话框的候选项目列表。 */
    projects: ProjectInfo[];
    workspaceId?: string;
    onSelectGroup?: (group: ProjectGroupSummary) => void;
    /**
     * 当外部接管创建按钮和对话框时传入此回调。
     * - 列表内部不再渲染顶部的 "+ 新建项目组" 按钮；
     * - 空态/列表内的创建按钮仅触发该回调，不再持有自己的对话框状态；
     * - 适用于将创建按钮上移到 Tab 上方页头的场景。
     */
    onRequestCreate?: () => void;
}
/**
 * 项目组列表视图：网格 + 新建按钮 + 创建对话框 + 空态。
 * 作为 ``ProjectsPage`` 中"项目组"Tab 的主体内容。
 */
export declare function ProjectGroupList({ projects, workspaceId, onSelectGroup, onRequestCreate, }: ProjectGroupListProps): import("react").JSX.Element;
//# sourceMappingURL=ProjectGroupList.d.ts.map