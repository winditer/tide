import { type ProjectInfo } from "@tide/core";
export interface ProjectGroupCreateDialogProps {
    /** 候选项目（来自 ``useProjects``）。 */
    projects: ProjectInfo[];
    workspaceId?: string;
    onClose: () => void;
    onSuccess?: (groupId: string) => void;
}
/**
 * 新建项目组对话框：填写名称/描述，并从已有项目列表中多选成员。
 * 选择顺序敏感 —— 第一个被选择的项目将被后端标记为 ``primary``。
 */
export declare function ProjectGroupCreateDialog({ projects, workspaceId, onClose, onSuccess, }: ProjectGroupCreateDialogProps): import("react").JSX.Element;
//# sourceMappingURL=ProjectGroupCreateDialog.d.ts.map