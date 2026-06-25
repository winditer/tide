import { type KnowledgeScope } from "@tide/core";
export interface KnowledgeGraphCardProps {
    /** 范围：project（单个项目）或 group（项目组）。 */
    scope: KnowledgeScope;
    /** project_id 或 group_id。 */
    targetId: string;
}
/**
 * 知识图谱卡片：嵌入到项目 / 项目组的设置 Tab 中。
 *
 * 功能：
 * - 查看 `.knowledge/` 下所有 Markdown / JSON 文件；
 * - 选择文件后右侧显示内容（.md 可切换到编辑模式后保存）；
 * - 支持删除单个文件；
 * - "立即生成" 按异步任务执行后端脚本，自动轮询进度。
 */
export declare function KnowledgeGraphCard({ scope, targetId }: KnowledgeGraphCardProps): import("react").JSX.Element;
//# sourceMappingURL=KnowledgeGraphCard.d.ts.map