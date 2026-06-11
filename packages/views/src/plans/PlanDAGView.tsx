"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

import { usePlanDAG } from "@tide/core";
import type { PlanDAGNode, PlanDAGEdge } from "@tide/core";
import { PlanTaskNode } from "./PlanTaskNode";

const elk = new ELK();

const NODE_WIDTH = 260;
const NODE_HEIGHT = 110;

const ELK_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "100",
  "elk.spacing.nodeNode": "60",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.edgeRouting": "ORTHOGONAL",
};

async function layoutGraph(
  nodes: PlanDAGNode[],
  edges: PlanDAGEdge[]
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: ELK_OPTIONS,
    children: nodes.map((n) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const result = await elk.layout(elkGraph);

  const positioned = (result.children ?? []).reduce<
    Record<string, { x: number; y: number }>
  >((acc, c) => {
    if (c.id) acc[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
    return acc;
  }, {});

  const flowNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    type: "task",
    position: positioned[n.id] ?? n.position ?? { x: 0, y: 0 },
    data: n.data as unknown as Record<string, unknown>,
  }));

  const flowEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    animated: false,
    style: {
      stroke: "rgba(99,102,241,0.55)",
      strokeWidth: 1.5,
    },
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

const nodeTypes = { task: PlanTaskNode };

interface PlanDAGViewProps {
  planId: string;
  onNodeClick?: (nodeId: string, data: PlanDAGNode["data"]) => void;
  refetchInterval?: number;
}

function DAGCanvas({ planId, onNodeClick, refetchInterval }: PlanDAGViewProps) {
  const { data, isLoading, isError, error } = usePlanDAG(planId, {
    refetchInterval,
  });
  const [layouted, setLayouted] = useState<{
    nodes: Node[];
    edges: Edge[];
  } | null>(null);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    layoutGraph(data.nodes ?? [], data.edges ?? []).then((res) => {
      if (!cancelled) setLayouted(res);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const handleNodeClick: NodeMouseHandler = (_evt, node) => {
    onNodeClick?.(node.id, node.data as unknown as PlanDAGNode["data"]);
  };

  const isEmpty = useMemo(
    () => !!data && (data.nodes?.length ?? 0) === 0,
    [data]
  );

  if (isLoading || (!layouted && !isError)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-xs tracking-widest text-zinc-500">
          ◐ COMPUTING LAYOUT…
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-xs text-rose-600">
          ✕ DAG LOAD FAILED — {String(error)}
        </div>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-xs tracking-widest text-zinc-500">
          ◇ NO NODES IN THIS PLAN
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={layouted?.nodes ?? []}
      edges={layouted?.edges ?? []}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.6}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1.2}
        color="rgba(99,102,241,0.18)"
      />
      <Controls
        showInteractive={false}
        className="!rounded-lg !border !border-border/60 !bg-card !shadow-sm"
      />
      <MiniMap
        zoomable
        pannable
        nodeStrokeWidth={3}
        nodeColor={(n) => {
          const status = String(
            (n.data as unknown as PlanDAGNode["data"])?.status ?? "queued"
          );
          const m: Record<string, string> = {
            queued: "#94a3b8",
            running: "#f59e0b",
            review: "#8b5cf6",
            completed: "#059669",
            approved: "#10b981",
            failed: "#dc2626",
            stopped: "#71717a",
            cancelled: "#71717a",
            rejected: "#ef4444",
          };
          return m[status] ?? "#94a3b8";
        }}
        className="!rounded-lg !border !border-border/60 !bg-card !shadow-sm"
      />
    </ReactFlow>
  );
}

export function PlanDAGView(props: PlanDAGViewProps) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border/50 bg-muted/20">
      {/* Header strip */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/80 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground shadow-sm backdrop-blur">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
        <span>DAG · LAYERED · ELK</span>
      </div>

      <ReactFlowProvider>
        <DAGCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
