"use client";

import { WorkflowCanvas } from "./WorkflowCanvas";
import type {
  WorkflowDefinition,
  WorkflowNodeRun,
  WorkflowRun,
} from "@tide/core";

interface WorkflowRunViewProps {
  definition: WorkflowDefinition;
  run: WorkflowRun;
  subtitle?: string;
  toolbarExtra?: React.ReactNode;
}

export function WorkflowRunView({
  definition,
  run,
  subtitle,
  toolbarExtra,
}: WorkflowRunViewProps) {
  const nodeRuns: WorkflowNodeRun[] = run.node_runs ?? [];

  return (
    <WorkflowCanvas
      definition={definition}
      nodeRuns={nodeRuns}
      readOnly
      subtitle={subtitle}
      toolbarExtra={toolbarExtra}
    />
  );
}
