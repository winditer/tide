"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK from "elkjs/lib/elk.bundled.js";
import { usePlanDAG } from "@tide/core";
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
async function layoutGraph(nodes, edges) {
    var _a;
    const elkGraph = {
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
    const positioned = ((_a = result.children) !== null && _a !== void 0 ? _a : []).reduce((acc, c) => {
        var _a, _b;
        if (c.id)
            acc[c.id] = { x: (_a = c.x) !== null && _a !== void 0 ? _a : 0, y: (_b = c.y) !== null && _b !== void 0 ? _b : 0 };
        return acc;
    }, {});
    const flowNodes = nodes.map((n) => {
        var _a, _b;
        return ({
            id: n.id,
            type: "task",
            position: (_b = (_a = positioned[n.id]) !== null && _a !== void 0 ? _a : n.position) !== null && _b !== void 0 ? _b : { x: 0, y: 0 },
            data: n.data,
        });
    });
    const flowEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        animated: false,
        style: {
            stroke: "rgba(24,24,27,0.6)",
            strokeWidth: 1.5,
            strokeDasharray: "4 3",
        },
    }));
    return { nodes: flowNodes, edges: flowEdges };
}
const nodeTypes = { task: PlanTaskNode };
function DAGCanvas({ planId, onNodeClick, refetchInterval }) {
    var _a, _b;
    const { data, isLoading, isError, error } = usePlanDAG(planId, {
        refetchInterval,
    });
    const [layouted, setLayouted] = useState(null);
    useEffect(() => {
        var _a, _b;
        if (!data)
            return;
        let cancelled = false;
        layoutGraph((_a = data.nodes) !== null && _a !== void 0 ? _a : [], (_b = data.edges) !== null && _b !== void 0 ? _b : []).then((res) => {
            if (!cancelled)
                setLayouted(res);
        });
        return () => {
            cancelled = true;
        };
    }, [data]);
    const handleNodeClick = (_evt, node) => {
        onNodeClick === null || onNodeClick === void 0 ? void 0 : onNodeClick(node.id, node.data);
    };
    const isEmpty = useMemo(() => { var _a, _b; return !!data && ((_b = (_a = data.nodes) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) === 0; }, [data]);
    if (isLoading || (!layouted && !isError)) {
        return (_jsx("div", { className: "flex h-full items-center justify-center", children: _jsx("div", { className: "font-mono text-xs tracking-widest text-zinc-500", children: "\u25D0 COMPUTING LAYOUT\u2026" }) }));
    }
    if (isError) {
        return (_jsx("div", { className: "flex h-full items-center justify-center", children: _jsxs("div", { className: "font-mono text-xs text-rose-600", children: ["\u2715 DAG LOAD FAILED \u2014 ", String(error)] }) }));
    }
    if (isEmpty) {
        return (_jsx("div", { className: "flex h-full items-center justify-center", children: _jsx("div", { className: "font-mono text-xs tracking-widest text-zinc-500", children: "\u25C7 NO NODES IN THIS PLAN" }) }));
    }
    return (_jsxs(ReactFlow, { nodes: (_a = layouted === null || layouted === void 0 ? void 0 : layouted.nodes) !== null && _a !== void 0 ? _a : [], edges: (_b = layouted === null || layouted === void 0 ? void 0 : layouted.edges) !== null && _b !== void 0 ? _b : [], nodeTypes: nodeTypes, onNodeClick: handleNodeClick, fitView: true, fitViewOptions: { padding: 0.25 }, proOptions: { hideAttribution: true }, minZoom: 0.2, maxZoom: 1.6, nodesDraggable: false, nodesConnectable: false, elementsSelectable: true, children: [_jsx(Background, { variant: BackgroundVariant.Dots, gap: 20, size: 1.2, color: "rgba(24,24,27,0.18)" }), _jsx(Controls, { showInteractive: false, className: "!border !border-zinc-900 !bg-white !shadow-[3px_3px_0_0_rgba(24,24,27,0.92)]" }), _jsx(MiniMap, { zoomable: true, pannable: true, nodeStrokeWidth: 3, nodeColor: (n) => {
                    var _a, _b, _c;
                    const status = String((_b = (_a = n.data) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : "queued");
                    const m = {
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
                    return (_c = m[status]) !== null && _c !== void 0 ? _c : "#94a3b8";
                }, className: "!border !border-zinc-900 !bg-white !shadow-[3px_3px_0_0_rgba(24,24,27,0.92)]" })] }));
}
export function PlanDAGView(props) {
    return (_jsxs("div", { className: "relative h-full w-full overflow-hidden border border-zinc-900 bg-[radial-gradient(circle_at_1px_1px,rgba(24,24,27,0.08)_1px,transparent_0)] bg-[length:18px_18px]", children: [_jsx(CornerTick, { className: "left-[-1px] top-[-1px]" }), _jsx(CornerTick, { className: "right-[-1px] top-[-1px] rotate-90" }), _jsx(CornerTick, { className: "left-[-1px] bottom-[-1px] -rotate-90" }), _jsx(CornerTick, { className: "right-[-1px] bottom-[-1px] rotate-180" }), _jsxs("div", { className: "pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-zinc-700", children: [_jsx("span", { className: "inline-block h-2 w-2 bg-zinc-900" }), _jsx("span", { children: "DAG \u00B7 LAYERED \u00B7 ELK" })] }), _jsx(ReactFlowProvider, { children: _jsx(DAGCanvas, Object.assign({}, props)) })] }));
}
function CornerTick({ className }) {
    return (_jsx("svg", { className: `pointer-events-none absolute h-4 w-4 ${className !== null && className !== void 0 ? className : ""}`, viewBox: "0 0 16 16", fill: "none", children: _jsx("path", { d: "M0 0 L16 0 L16 1 L1 1 L1 16 L0 16 Z", fill: "rgb(24,24,27)" }) }));
}
//# sourceMappingURL=PlanDAGView.js.map