export { StartNode } from "./StartNode";
export { EndNode } from "./EndNode";
export { AgentNode } from "./AgentNode";
export { ApprovalNode } from "./ApprovalNode";
export { ConditionNode } from "./ConditionNode";
export { ParallelNode } from "./ParallelNode";
export { ParallelJoinNode } from "./ParallelJoinNode";
export { DelayNode } from "./DelayNode";
export { StageNode } from "./StageNode";
export { GitMergeNode } from "./GitMergeNode";

import { StartNode } from "./StartNode";
import { EndNode } from "./EndNode";
import { AgentNode } from "./AgentNode";
import { ApprovalNode } from "./ApprovalNode";
import { ConditionNode } from "./ConditionNode";
import { ParallelNode } from "./ParallelNode";
import { ParallelJoinNode } from "./ParallelJoinNode";
import { DelayNode } from "./DelayNode";
import { StageNode } from "./StageNode";
import { GitMergeNode } from "./GitMergeNode";

export const workflowNodeTypes = {
  start: StartNode,
  end: EndNode,
  agent: AgentNode,
  approval: ApprovalNode,
  condition: ConditionNode,
  parallel: ParallelNode,
  parallel_join: ParallelJoinNode,
  delay: DelayNode,
  stage: StageNode,
  git_merge: GitMergeNode,
} as const;
