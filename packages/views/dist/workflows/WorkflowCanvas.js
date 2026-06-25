"use client";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState, } from "react";
import { ReactFlow, ReactFlowProvider, useReactFlow, Background, BackgroundVariant, Controls, MiniMap, addEdge, applyEdgeChanges, applyNodeChanges, } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@tide/ui";
import { workflowNodeTypes } from "./nodes";
import { NodePalette } from "./NodePalette";
import { PropertyPanel } from "./PropertyPanel";
const DEFAULT_LABELS = {
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
function defaultDataFor(type) {
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
                autoPush: false,
            };
        default:
            return { label: DEFAULT_LABELS[type] };
    }
}
function makeNodeId(type, existing) {
    let i = 1;
    while (existing.some((n) => n.id === `${type}_${i}`))
        i++;
    return `${type}_${i}`;
}
function defToFlow(def, runs, isReadOnly) {
    var _a, _b;
    const runByNode = new Map();
    (runs !== null && runs !== void 0 ? runs : []).forEach((r) => runByNode.set(r.node_id, r));
    const flowNodes = ((_a = def.nodes) !== null && _a !== void 0 ? _a : []).map((n) => {
        var _a;
        const run = runByNode.get(n.id);
        return {
            id: n.id,
            type: n.type,
            position: (_a = n.position) !== null && _a !== void 0 ? _a : { x: 0, y: 0 },
            data: Object.assign(Object.assign({}, n.data), { runStatus: run === null || run === void 0 ? void 0 : run.status, runError: run === null || run === void 0 ? void 0 : run.error, runOutput: run === null || run === void 0 ? void 0 : run.output }),
            draggable: !isReadOnly,
            selectable: true,
        };
    });
    const visitedEdges = new Set();
    // Mark edges traversed by completed nodes
    (runs !== null && runs !== void 0 ? runs : []).forEach((r) => {
        if (r.status === "completed" || r.status === "running") {
            visitedEdges.add(r.node_id);
        }
    });
    const flowEdges = ((_b = def.edges) !== null && _b !== void 0 ? _b : []).map((e) => {
        var _a, _b;
        const sourceRun = runByNode.get(e.source);
        const targetRun = runByNode.get(e.target);
        const traversed = (sourceRun === null || sourceRun === void 0 ? void 0 : sourceRun.status) === "completed" &&
            ((targetRun === null || targetRun === void 0 ? void 0 : targetRun.status) === "running" ||
                (targetRun === null || targetRun === void 0 ? void 0 : targetRun.status) === "completed" ||
                (targetRun === null || targetRun === void 0 ? void 0 : targetRun.status) === "failed");
        return {
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: (_a = e.sourceHandle) !== null && _a !== void 0 ? _a : undefined,
            targetHandle: (_b = e.targetHandle) !== null && _b !== void 0 ? _b : undefined,
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
            labelBgPadding: [4, 2],
            style: {
                stroke: traversed ? "#059669" : "rgba(24,24,27,0.65)",
                strokeWidth: traversed ? 2.5 : 1.5,
                strokeDasharray: traversed ? undefined : "4 3",
            },
        };
    });
    return { nodes: flowNodes, edges: flowEdges };
}
function flowToDef(nodes, edges) {
    const wfNodes = nodes.map((n) => {
        var _a, _b;
        const _c = ((_a = n.data) !== null && _a !== void 0 ? _a : {}), { runStatus, runError, runOutput } = _c, rest = __rest(_c, ["runStatus", "runError", "runOutput"]);
        return {
            id: n.id,
            type: ((_b = n.type) !== null && _b !== void 0 ? _b : "agent"),
            position: n.position,
            data: rest,
        };
    });
    const wfEdges = edges.map((e) => {
        var _a, _b;
        return ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: (_a = e.sourceHandle) !== null && _a !== void 0 ? _a : undefined,
            targetHandle: (_b = e.targetHandle) !== null && _b !== void 0 ? _b : undefined,
            label: typeof e.label === "string" ? e.label : undefined,
        });
    });
    return { nodes: wfNodes, edges: wfEdges };
}
function CanvasInner({ definition, nodeRuns, readOnly, onChange, onSave, onRun, isSaving, isRunning, toolbarExtra, subtitle, projectId, }) {
    const wrapperRef = useRef(null);
    const { screenToFlowPosition } = useReactFlow();
    const initial = useMemo(() => defToFlow(definition, nodeRuns, readOnly), 
    // We intentionally only re-run when the input definition reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [definition, nodeRuns, readOnly]);
    const [nodes, setNodes] = useState(initial.nodes);
    const [edges, setEdges] = useState(initial.edges);
    const [selectedId, setSelectedId] = useState(null);
    // Refs to always hold the latest nodes/edges (updated inside state updaters)
    const nodesRef = useRef(nodes);
    const edgesRef = useRef(edges);
    // Track the last definition we emitted to avoid sync-echo overwrites
    const lastEmittedRef = useRef(null);
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
            var _a;
            const def = flowToDef(nodesRef.current, edgesRef.current);
            lastEmittedRef.current = def;
            (_a = onChangeRef.current) === null || _a === void 0 ? void 0 : _a.call(onChangeRef, def);
        });
    }, []);
    const onNodesChange = useCallback((changes) => {
        setNodes((nds) => {
            const next = applyNodeChanges(changes, nds);
            nodesRef.current = next;
            if (!readOnly)
                emitChange();
            return next;
        });
    }, [emitChange, readOnly]);
    const onEdgesChange = useCallback((changes) => {
        setEdges((eds) => {
            const next = applyEdgeChanges(changes, eds);
            edgesRef.current = next;
            if (!readOnly)
                emitChange();
            return next;
        });
    }, [emitChange, readOnly]);
    const onConnect = useCallback((params) => {
        setEdges((eds) => {
            var _a;
            const id = `e_${params.source}_${params.target}_${(_a = params.sourceHandle) !== null && _a !== void 0 ? _a : ""}_${Date.now().toString(36)}`;
            const next = addEdge(Object.assign(Object.assign({}, params), { id, type: "smoothstep", label: params.sourceHandle === "yes"
                    ? "yes"
                    : params.sourceHandle === "no"
                        ? "no"
                        : undefined, style: {
                    stroke: "rgba(24,24,27,0.65)",
                    strokeWidth: 1.5,
                    strokeDasharray: "4 3",
                }, labelStyle: {
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    fontSize: 10,
                    letterSpacing: "0.15em",
                    fill: "#18181b",
                }, labelBgStyle: { fill: "#fff", stroke: "#18181b", strokeWidth: 1 }, labelBgPadding: [4, 2] }), eds);
            edgesRef.current = next;
            emitChange();
            return next;
        });
    }, [emitChange]);
    const handleAddNode = useCallback((type, position) => {
        const id = makeNodeId(type, nodesRef.current);
        const newNode = {
            id,
            type,
            position: position !== null && position !== void 0 ? position : { x: 240, y: 80 + nodesRef.current.length * 40 },
            data: defaultDataFor(type),
            draggable: !readOnly,
            selectable: true,
        };
        const next = nodesRef.current.concat(newNode);
        setNodes(next);
        nodesRef.current = next;
        setSelectedId(id);
        emitChange();
    }, [emitChange, readOnly]);
    const onDragOver = useCallback((event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    }, []);
    const onDrop = useCallback((event) => {
        event.preventDefault();
        if (readOnly)
            return;
        const type = event.dataTransfer.getData("application/x-workflow-node");
        if (!type)
            return;
        const position = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
        });
        handleAddNode(type, position);
    }, [readOnly, screenToFlowPosition, handleAddNode]);
    const handleNodeClick = useCallback((_e, node) => {
        setSelectedId(node.id);
    }, []);
    const handleUpdateNodeData = useCallback((id, data) => {
        setNodes((nds) => {
            const next = nds.map((n) => n.id === id ? Object.assign(Object.assign({}, n), { data: Object.assign({}, data) }) : n);
            nodesRef.current = next;
            emitChange();
            return next;
        });
    }, [emitChange]);
    const handleDeleteNode = useCallback((id) => {
        const nextNodes = nodesRef.current.filter((n) => n.id !== id);
        const nextEdges = edgesRef.current.filter((e) => e.source !== id && e.target !== id);
        setNodes(nextNodes);
        setEdges(nextEdges);
        nodesRef.current = nextNodes;
        edgesRef.current = nextEdges;
        setSelectedId(null);
        emitChange();
    }, [emitChange]);
    const selectedNode = useMemo(() => {
        var _a, _b;
        if (!selectedId)
            return null;
        const found = nodes.find((n) => n.id === selectedId);
        if (!found)
            return null;
        const _c = ((_a = found.data) !== null && _a !== void 0 ? _a : {}), { runStatus, runError, runOutput } = _c, rest = __rest(_c, ["runStatus", "runError", "runOutput"]);
        return {
            id: found.id,
            type: ((_b = found.type) !== null && _b !== void 0 ? _b : "agent"),
            position: found.position,
            data: rest,
        };
    }, [nodes, selectedId]);
    const handleSaveClick = useCallback(() => {
        onSave === null || onSave === void 0 ? void 0 : onSave(flowToDef(nodesRef.current, edgesRef.current));
    }, [onSave]);
    return (_jsxs("div", { className: "flex h-full w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-card", children: [!readOnly && _jsx(NodePalette, { onAddNode: (t) => handleAddNode(t) }), _jsxs("div", { className: "relative flex min-w-0 flex-1 flex-col", children: [_jsxs("div", { className: "flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-2", children: [_jsx("span", { className: "inline-block h-2 w-2 rounded-full bg-emerald-500" }), _jsxs("span", { className: "text-xs font-medium text-foreground", children: ["\u5DE5\u4F5C\u6D41", readOnly ? " · 运行" : " · 编辑"] }), subtitle && (_jsxs("span", { className: "ml-2 truncate text-xs text-muted-foreground", children: ["/ ", subtitle] })), _jsxs("div", { className: "ml-auto flex items-center gap-2", children: [!readOnly && onSave && (_jsx(Button, { size: "sm", variant: "outline", disabled: isSaving, onClick: handleSaveClick, children: isSaving ? "保存中…" : "💾 保存" })), onRun && (_jsx(Button, { size: "sm", disabled: isRunning, onClick: onRun, children: isRunning ? "运行中…" : "▶ 运行" })), toolbarExtra] })] }), _jsxs("div", { ref: wrapperRef, className: "relative flex-1 bg-muted/20", onDrop: onDrop, onDragOver: onDragOver, children: [_jsxs(ReactFlow, { nodes: nodes, edges: edges, nodeTypes: workflowNodeTypes, onNodesChange: onNodesChange, onEdgesChange: onEdgesChange, onConnect: onConnect, onNodeClick: handleNodeClick, onPaneClick: () => setSelectedId(null), fitView: true, fitViewOptions: { padding: 0.25 }, proOptions: { hideAttribution: true }, minZoom: 0.2, maxZoom: 1.6, nodesDraggable: !readOnly, nodesConnectable: !readOnly, elementsSelectable: true, deleteKeyCode: readOnly ? null : ["Backspace", "Delete"], children: [_jsx(Background, { variant: BackgroundVariant.Dots, gap: 20, size: 1.2, color: "rgba(24,24,27,0.18)" }), _jsx(Controls, { showInteractive: false, className: "!border !border-border !bg-card !rounded-lg !shadow-card" }), _jsx(MiniMap, { zoomable: true, pannable: true, nodeStrokeWidth: 3, nodeColor: (n) => {
                                            var _a, _b, _c;
                                            const status = String((_b = (_a = n.data) === null || _a === void 0 ? void 0 : _a.runStatus) !== null && _b !== void 0 ? _b : "idle");
                                            const m = {
                                                idle: "#a1a1aa",
                                                pending: "#71717a",
                                                running: "#0284c7",
                                                completed: "#059669",
                                                failed: "#dc2626",
                                                skipped: "#d4d4d8",
                                            };
                                            return (_c = m[status]) !== null && _c !== void 0 ? _c : "#a1a1aa";
                                        }, className: "!border !border-border !bg-card !rounded-lg !shadow-card" })] }), nodes.length === 0 && (_jsx("div", { className: "pointer-events-none absolute inset-0 flex items-center justify-center", children: _jsxs("div", { className: "rounded-xl border border-border/50 bg-card px-8 py-6 text-center shadow-card", children: [_jsx("div", { className: "text-xs font-medium text-muted-foreground", children: "\u7A7A\u753B\u5E03" }), _jsx("div", { className: "mt-2 text-xs text-muted-foreground", children: "\u4ECE\u5DE6\u4FA7\u62D6\u5165\u8282\u70B9\u5F00\u59CB\u6784\u5EFA\u5DE5\u4F5C\u6D41" })] }) }))] })] }), _jsx(PropertyPanel, { node: selectedNode, readOnly: readOnly, onUpdate: handleUpdateNodeData, onDelete: handleDeleteNode, projectId: projectId })] }));
}
export function WorkflowCanvas(props) {
    return (_jsx(ReactFlowProvider, { children: _jsx(CanvasInner, Object.assign({}, props)) }));
}
//# sourceMappingURL=WorkflowCanvas.js.map