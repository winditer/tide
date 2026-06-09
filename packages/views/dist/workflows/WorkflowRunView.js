"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { WorkflowCanvas } from "./WorkflowCanvas";
export function WorkflowRunView({ definition, run, subtitle, toolbarExtra, }) {
    var _a;
    const nodeRuns = (_a = run.node_runs) !== null && _a !== void 0 ? _a : [];
    return (_jsx(WorkflowCanvas, { definition: definition, nodeRuns: nodeRuns, readOnly: true, subtitle: subtitle, toolbarExtra: toolbarExtra }));
}
//# sourceMappingURL=WorkflowRunView.js.map