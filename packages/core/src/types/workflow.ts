export type WorkflowNodeType =
  | "start"
  | "end"
  | "agent"
  | "approval"
  | "condition"
  | "parallel"
  | "parallel_join"
  | "delay";

export interface WorkflowNodeData {
  label: string;
  // Node-type specific fields are kept open for forward compatibility:
  // agent: prompt, model, agent_id
  // approval: approvers (string[])
  // condition: field, operator, value
  // delay: seconds
  [key: string]: any;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowNodeRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface WorkflowNodeRun {
  id: string;
  node_id: string;
  node_type: string;
  status: WorkflowNodeRunStatus;
  started_at: string | null;
  finished_at: string | null;
  output: any;
  error: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: WorkflowRunStatus;
  input_context: Record<string, any>;
  started_at: string;
  finished_at: string | null;
  node_runs: WorkflowNodeRun[];
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  definition: WorkflowDefinition;
  enabled?: boolean;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  definition?: WorkflowDefinition;
  enabled?: boolean;
}

export interface RunWorkflowInput {
  input_context?: Record<string, any>;
}
