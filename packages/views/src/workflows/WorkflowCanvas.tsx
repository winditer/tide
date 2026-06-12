"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@tide/ui";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
  WorkflowNodeRun,
} from "@tide/core";

import { workflowNodeTypes } from "./nodes";
import { NodePalette } from "./NodePalette";
import { PropertyPanel } from "./PropertyPanel";

const DEFAULT_LABELS: Record<WorkflowNodeType, string> = {
  start: "Start",
  end: "End",
  agent: "Agent",
  approval: "Approval",
  condition: "Condition",
  parallel: "Fork",
  parallel_join: "Join",
  delay: "Delay",
  stage: "Stage",
  git_merge: "Git Merge",
};

function defaultDataFor(type: WorkflowNodeType): Record<string, any> {
  switch (type) {
    case "agent":
      return { label: "Code Agent", model: "gpt-4", prompt: "" };
    case "approval":
      return { label: "Review", approvers: [] };
    case "condition":
      return { label: "Branch", field: "", operator: "eq", value: "" };
    case "delay":
      return { label: "Wait", seconds: 30 };
    case "parallel":
      return { label: "Fork" };
    case "parallel_join":
      return { label: "Join" };
    case "stage":
      return { label: "Stage", category: "custom" };
    case "git_merge":
      return {
        label: "Git Merge",
        sourceBranch: "",
        targetBranch: "",
        mergeStrategy: "merge",
        deleteSource: false,
        onConflict: "fail",
      };
    default:
      return { label: DEFAULT_LABELS[type] };
  }
}

function makeNodeId(type: WorkflowNodeType, existing: Node[]): string {
  let i = 1;
  while (existing.some((n) => n.id === `${type}_${i}`)) i++;
  return `${type}_${i}`;
}

function defToFlow(
  def: WorkflowDefinition,
  runs?: WorkflowNodeRun[],
  isReadOnly?: boolean
): { nodes: Node[]; edges: Edge[] } {
  const runByNode = new Map<string, WorkflowNodeRun>();
  (runs ?? []).forEach((r) => runByNode.set(r.node_id, r));

  const flowNodes: Node[] = (def.nodes ?? []).map((n) => {
    const run = runByNode.get(n.id);
    return {
      id: n.id,
      type: n.type,
      position: n.position ?? { x: 0, y: 0 },
      data: {
        ...n.data,
        runStatus: run?.status,
        runError: run?.error,
        runOutput: run?.output,
      },
      draggable: !isReadOnly,
      selectable: true,
    };
  });

  const visitedEdges = new Set<string>();
  // Mark edges traversed by completed nodes
  (runs ?? []).forEach((r) => {
    if (r.status === "completed" || r.status === "running") {
      visitedEdges.add(r.node_id);
    }
  });

  const flowEdges: Edge[] = (def.edges ?? []).map((e) => {
    const sourceRun = runByNode.get(e.source);
    const targetRun = runByNode.get(e.target);
    const traversed =
      sourceRun?.status === "completed" &&
      (targetRun?.status === "running" ||
        targetRun?.status === "completed" ||
        targetRun?.status === "failed");

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      label: e.label,
      type: "smoothstep",
      animated: traversed,
      labelStyle: {
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        fontSize: 10,
        letterSpacing: "0.15em",
        fill: "#18181b",
      },
      labelBgStyle: { fill: "#fff", stroke: "#18181b", strokeWidth: 1 },
      labelBgPadding: [4, 2] as [number, number],
      style: {
        stroke: traversed ? "#059669" : "rgba(24,24,27,0.65)",
        strokeWidth: traversed ? 2.5 : 1.5,
        strokeDasharray: traversed ? undefined : "4 3",
      },
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

function flowToDef(nodes: Node[], edges: Edge[]): WorkflowDefinition {
  const wfNodes: WorkflowNode[] = nodes.map((n) => {
    const { runStatus, runError, runOutput, ...rest } = (n.data ?? {}) as any;
    return {
      id: n.id,
      type: (n.type ?? "agent") as WorkflowNodeType,
      position: n.position,
      data: rest,
    };
  });
  const wfEdges: WorkflowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    label: typeof e.label === "string" ? e.label : undefined,
  }));
  return { nodes: wfNodes, edges: wfEdges };
}

export interface WorkflowCanvasProps {
  definition: WorkflowDefinition;
  /** When provided, switches into runtime / read-only mode and color nodes by status. */
  nodeRuns?: WorkflowNodeRun[];
  readOnly?: boolean;
  onChange?: (def: WorkflowDefinition) => void;
  onSave?: (def: WorkflowDefinition) => void;
  onRun?: () => void;
  isSaving?: boolean;
  isRunning?: boolean;
  /** Optional toolbar-right slot (for custom actions like cancel run) */
  toolbarExtra?: React.ReactNode;
  /** Sub-title shown in the canvas chrome */
  subtitle?: string;
  /** Optional project context for member-aware fields (e.g. approval node approvers) */
  projectId?: string;
}

function CanvasInner({
  definition,
  nodeRuns,
  readOnly,
  onChange,
  onSave,
  onRun,
  isSaving,
  isRunning,
  toolbarExtra,
  subtitle,
  projectId,
}: WorkflowCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const initial = useMemo(
    () => defToFlow(definition, nodeRuns, readOnly),
    // We intentionally only re-run when the input definition reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [definition, nodeRuns, readOnly]
  );

  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Refs to always hold the latest nodes/edges (updated inside state updaters)
  const nodesRef = useRef<Node[]>(nodes);
  const edgesRef = useRef<Edge[]>(edges);

  // Track the last definition we emitted to avoid sync-echo overwrites
  const lastEmittedRef = useRef<WorkflowDefinition | null>(null);

  // Sync when external definition or runs change (e.g. polling).
  // Skip when the change was triggered by our own emitChange.
  useEffect(() => {
    if (lastEmittedRef.current && lastEmittedRef.current === definition) {
      lastEmittedRef.current = null;
      return;
    }
    lastEmittedRef.current = null;
    setNodes(initial.nodes);
    setEdges(initial.edges);
    nodesRef.current = initial.nodes;
    edgesRef.current = initial.edges;
  }, [initial, definition]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const emitChange = useCallback(() => {
    queueMicrotask(() => {
      const def = flowToDef(nodesRef.current, edgesRef.current);
      lastEmittedRef.current = def;
      onChangeRef.current?.(def);
    });
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds);
        nodesRef.current = next;
        if (!readOnly) emitChange();
        return next;
      });
    },
    [emitChange, readOnly]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        edgesRef.current = next;
        if (!readOnly) emitChange();
        return next;
      });
    },
    [emitChange, readOnly]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const id = `e_${params.source}_${params.target}_${
          params.sourceHandle ?? ""
        }_${Date.now().toString(36)}`;
        const next = addEdge(
          {
            ...params,
            id,
            type: "smoothstep",
            label:
              params.sourceHandle === "yes"
                ? "yes"
                : params.sourceHandle === "no"
                  ? "no"
                  : undefined,
            style: {
              stroke: "rgba(24,24,27,0.65)",
              strokeWidth: 1.5,
              strokeDasharray: "4 3",
            },
            labelStyle: {
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 10,
              letterSpacing: "0.15em",
              fill: "#18181b",
            },
            labelBgStyle: { fill: "#fff", stroke: "#18181b", strokeWidth: 1 },
            labelBgPadding: [4, 2] as [number, number],
          },
          eds
        );
        edgesRef.current = next;
        emitChange();
        return next;
      });
    },
    [emitChange]
  );

  const handleAddNode = useCallback(
    (type: WorkflowNodeType, position?: { x: number; y: number }) => {
      const id = makeNodeId(type, nodesRef.current);
      const newNode: Node = {
        id,
        type,
        position: position ?? { x: 240, y: 80 + nodesRef.current.length * 40 },
        data: defaultDataFor(type),
        draggable: !readOnly,
        selectable: true,
      };
      const next = nodesRef.current.concat(newNode);
      setNodes(next);
      nodesRef.current = next;
      setSelectedId(id);
      emitChange();
    },
    [emitChange, readOnly]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (readOnly) return;
      const type = event.dataTransfer.getData(
        "application/x-workflow-node"
      ) as WorkflowNodeType;
      if (!type) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      handleAddNode(type, position);
    },
    [readOnly, screenToFlowPosition, handleAddNode]
  );

  const handleNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    setSelectedId(node.id);
  }, []);

  const handleUpdateNodeData = useCallback(
    (id: string, data: Record<string, any>) => {
      setNodes((nds) => {
        const next = nds.map((n) =>
          n.id === id ? { ...n, data: { ...data } } : n
        );
        nodesRef.current = next;
        emitChange();
        return next;
      });
    },
    [emitChange]
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      const nextNodes = nodesRef.current.filter((n) => n.id !== id);
      const nextEdges = edgesRef.current.filter(
        (e) => e.source !== id && e.target !== id
      );
      setNodes(nextNodes);
      setEdges(nextEdges);
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setSelectedId(null);
      emitChange();
    },
    [emitChange]
  );

  const selectedNode: WorkflowNode | null = useMemo(() => {
    if (!selectedId) return null;
    const found = nodes.find((n) => n.id === selectedId);
    if (!found) return null;
    const { runStatus, runError, runOutput, ...rest } = (found.data ??
      {}) as any;
    return {
      id: found.id,
      type: (found.type ?? "agent") as WorkflowNodeType,
      position: found.position,
      data: rest,
    };
  }, [nodes, selectedId]);

  const handleSaveClick = useCallback(() => {
    onSave?.(flowToDef(nodesRef.current, edgesRef.current));
  }, [onSave]);

  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-card">
      {!readOnly && <NodePalette onAddNode={(t) => handleAddNode(t)} />}

      {/* Canvas + Toolbar */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-medium text-foreground">
            工作流{readOnly ? " · 运行" : " · 编辑"}
          </span>
          {subtitle && (
            <span className="ml-2 truncate text-xs text-muted-foreground">
              / {subtitle}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!readOnly && onSave && (
              <Button
                size="sm"
                variant="outline"
                disabled={isSaving}
                onClick={handleSaveClick}
              >
                {isSaving ? "保存中…" : "💾 保存"}
              </Button>
            )}
            {onRun && (
              <Button
                size="sm"
                disabled={isRunning}
                onClick={onRun}
              >
                {isRunning ? "运行中…" : "▶ 运行"}
              </Button>
            )}
            {toolbarExtra}
          </div>
        </div>

        <div
          ref={wrapperRef}
          className="relative flex-1 bg-muted/20"
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={workflowNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={1.6}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.2}
              color="rgba(24,24,27,0.18)"
            />
            <Controls
              showInteractive={false}
              className="!border !border-border !bg-card !rounded-lg !shadow-card"
            />
            <MiniMap
              zoomable
              pannable
              nodeStrokeWidth={3}
              nodeColor={(n) => {
                const status = String(
                  (n.data as any)?.runStatus ?? "idle"
                );
                const m: Record<string, string> = {
                  idle: "#a1a1aa",
                  pending: "#71717a",
                  running: "#0284c7",
                  completed: "#059669",
                  failed: "#dc2626",
                  skipped: "#d4d4d8",
                };
                return m[status] ?? "#a1a1aa";
              }}
              className="!border !border-border !bg-card !rounded-lg !shadow-card"
            />
          </ReactFlow>

          {/* Empty hint */}
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border border-border/50 bg-card px-8 py-6 text-center shadow-card">
                <div className="text-xs font-medium text-muted-foreground">
                  空画布
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  从左侧拖入节点开始构建工作流
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <PropertyPanel
        node={selectedNode}
        readOnly={readOnly}
        onUpdate={handleUpdateNodeData}
        onDelete={handleDeleteNode}
        projectId={projectId}
      />
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
