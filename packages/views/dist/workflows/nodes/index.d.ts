export { StartNode } from "./StartNode";
export { EndNode } from "./EndNode";
export { AgentNode } from "./AgentNode";
export { ApprovalNode } from "./ApprovalNode";
export { ConditionNode } from "./ConditionNode";
export { ParallelNode } from "./ParallelNode";
export { ParallelJoinNode } from "./ParallelJoinNode";
export { DelayNode } from "./DelayNode";
export declare const workflowNodeTypes: {
    readonly start: import("react").MemoExoticComponent<({ data, selected }: import("@xyflow/react").NodeProps) => import("react").JSX.Element>;
    readonly end: import("react").MemoExoticComponent<({ data, selected }: import("@xyflow/react").NodeProps) => import("react").JSX.Element>;
    readonly agent: import("react").MemoExoticComponent<({ data, selected }: import("@xyflow/react").NodeProps) => import("react").JSX.Element>;
    readonly approval: import("react").MemoExoticComponent<({ data, selected }: import("@xyflow/react").NodeProps) => import("react").JSX.Element>;
    readonly condition: import("react").MemoExoticComponent<({ data, selected }: import("@xyflow/react").NodeProps) => import("react").JSX.Element>;
    readonly parallel: import("react").MemoExoticComponent<({ data, selected }: import("@xyflow/react").NodeProps) => import("react").JSX.Element>;
    readonly parallel_join: import("react").MemoExoticComponent<({ data, selected }: import("@xyflow/react").NodeProps) => import("react").JSX.Element>;
    readonly delay: import("react").MemoExoticComponent<({ data, selected }: import("@xyflow/react").NodeProps) => import("react").JSX.Element>;
};
//# sourceMappingURL=index.d.ts.map