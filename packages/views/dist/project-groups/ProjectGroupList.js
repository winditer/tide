"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button } from "@tide/ui";
import { useDeleteProjectGroup, useProjectGroups, } from "@tide/core";
import { ProjectGroupCard } from "./ProjectGroupCard";
import { ProjectGroupCreateDialog } from "./ProjectGroupCreateDialog";
/**
 * 项目组列表视图：网格 + 新建按钮 + 创建对话框 + 空态。
 * 作为 ``ProjectsPage`` 中"项目组"Tab 的主体内容。
 */
export function ProjectGroupList({ projects, workspaceId, onSelectGroup, onRequestCreate, }) {
    var _a;
    const externalCreate = typeof onRequestCreate === "function";
    const [showCreate, setShowCreate] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);
    const triggerCreate = () => {
        if (externalCreate) {
            onRequestCreate();
        }
        else {
            setShowCreate(true);
        }
    };
    const { data, isLoading, isError } = useProjectGroups(workspaceId);
    const deleteMutation = useDeleteProjectGroup();
    const groups = (_a = data === null || data === void 0 ? void 0 : data.groups) !== null && _a !== void 0 ? _a : [];
    return (_jsxs("section", { className: "space-y-6", children: [!externalCreate && (_jsx("div", { className: "flex items-center justify-end", children: _jsx(Button, { onClick: () => setShowCreate(true), children: "\uFF0B \u65B0\u5EFA\u9879\u76EE\u7EC4" }) })), isLoading ? (_jsx("div", { className: "py-16 text-center text-sm text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" })) : isError ? (_jsx("div", { className: "py-16 text-center text-sm text-destructive", children: "\u52A0\u8F7D\u5931\u8D25" })) : groups.length === 0 ? (_jsxs("div", { className: "flex flex-col items-center justify-center rounded-xl bg-card py-20 text-center shadow-card", children: [_jsx("p", { className: "text-sm text-muted-foreground", children: "\u6682\u65E0\u9879\u76EE\u7EC4" }), _jsx("p", { className: "mt-2 text-base font-medium", children: "\u5C06\u591A\u4E2A\u4ED3\u5E93\u805A\u5408\uFF0C\u4FBF\u4E8E\u8DE8\u4ED3\u5E93\u5DE5\u4F5C\u9879\u7F16\u6392" }), _jsx("div", { className: "mt-6", children: _jsx(Button, { onClick: triggerCreate, children: "\uFF0B \u65B0\u5EFA\u9879\u76EE\u7EC4" }) })] })) : (_jsx("div", { className: "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3", children: groups.map((g) => (_jsx(ProjectGroupCard, { group: g, onClick: onSelectGroup, isDeleting: deleteMutation.isPending && pendingDeleteId === g.id, onDelete: async (group) => {
                        if (!confirm(`删除项目组 "${group.name}" ？\n（不会删除组内项目本身）`)) {
                            return;
                        }
                        setPendingDeleteId(group.id);
                        try {
                            await deleteMutation.mutateAsync(group.id);
                        }
                        finally {
                            setPendingDeleteId(null);
                        }
                    } }, g.id))) })), !externalCreate && showCreate && (_jsx(ProjectGroupCreateDialog, { projects: projects, workspaceId: workspaceId, onClose: () => setShowCreate(false) }))] }));
}
//# sourceMappingURL=ProjectGroupList.js.map