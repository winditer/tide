import type { ProjectGroupSummary } from "@tide/core";
export interface ProjectGroupCardProps {
    group: ProjectGroupSummary;
    onClick?: (group: ProjectGroupSummary) => void;
    onDelete?: (group: ProjectGroupSummary) => void;
    isDeleting?: boolean;
}
/**
 * 项目组卡片：展示组名、描述、成员数量与基本元信息。
 * 视觉与 ProjectsPage 的项目卡片保持一致（Card + shadow-card）。
 */
export declare function ProjectGroupCard({ group, onClick, onDelete, isDeleting, }: ProjectGroupCardProps): import("react").JSX.Element;
//# sourceMappingURL=ProjectGroupCard.d.ts.map