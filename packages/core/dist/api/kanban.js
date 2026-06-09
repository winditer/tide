import { apiClient } from "./client";
function buildQuery(params) {
    const searchParams = new URLSearchParams();
    if (params === null || params === void 0 ? void 0 : params.workspace_id)
        searchParams.set("workspace_id", params.workspace_id);
    const q = searchParams.toString();
    return q ? `?${q}` : "";
}
// ── 项目看板 ────────────────────────────────────────────────
// 后端返回：{ columns: { active: [...], completed: [...], archived: [...] } }
// 每个项目项：{ id, name, cwd, task_count, active_count, completed_count, status, last_active_at }
const PROJECT_COLUMN_ORDER = ["active", "completed", "archived"];
const PROJECT_COLUMN_TITLES = {
    active: "进行中",
    completed: "已完成",
    archived: "已归档",
};
function normalizeProjectBoard(raw) {
    var _a;
    if (!raw || !raw.columns)
        return { columns: [] };
    // 已经是数组格式（前端期望形态），直接透传
    if (Array.isArray(raw.columns)) {
        return { columns: raw.columns };
    }
    const columnsMap = raw.columns;
    const columns = PROJECT_COLUMN_ORDER.filter((key) => Array.isArray(columnsMap[key])).map((key) => {
        var _a, _b;
        return ({
            id: key,
            title: (_a = PROJECT_COLUMN_TITLES[key]) !== null && _a !== void 0 ? _a : key,
            cards: ((_b = columnsMap[key]) !== null && _b !== void 0 ? _b : []).map((p) => {
                var _a, _b, _c, _d, _e, _f, _g;
                return ({
                    id: String((_b = (_a = p.id) !== null && _a !== void 0 ? _a : p.cwd) !== null && _b !== void 0 ? _b : ""),
                    title: (_d = (_c = p.name) !== null && _c !== void 0 ? _c : p.cwd) !== null && _d !== void 0 ? _d : String((_e = p.id) !== null && _e !== void 0 ? _e : ""),
                    status: (_f = p.status) !== null && _f !== void 0 ? _f : key,
                    type: "project",
                    metadata: {
                        cwd: p.cwd,
                        task_count: p.task_count,
                        active_count: p.active_count,
                        completed_count: p.completed_count,
                    },
                    updated_at: (_g = p.last_active_at) !== null && _g !== void 0 ? _g : undefined,
                });
            }),
        });
    });
    // 将 PROJECT_COLUMN_ORDER 之外的额外列也保留下来
    for (const [key, items] of Object.entries(columnsMap)) {
        if (PROJECT_COLUMN_ORDER.includes(key))
            continue;
        if (!Array.isArray(items))
            continue;
        columns.push({
            id: key,
            title: (_a = PROJECT_COLUMN_TITLES[key]) !== null && _a !== void 0 ? _a : key,
            cards: items.map((p) => {
                var _a, _b, _c, _d, _e, _f, _g;
                return ({
                    id: String((_b = (_a = p.id) !== null && _a !== void 0 ? _a : p.cwd) !== null && _b !== void 0 ? _b : ""),
                    title: (_d = (_c = p.name) !== null && _c !== void 0 ? _c : p.cwd) !== null && _d !== void 0 ? _d : String((_e = p.id) !== null && _e !== void 0 ? _e : ""),
                    status: (_f = p.status) !== null && _f !== void 0 ? _f : key,
                    type: "project",
                    metadata: {
                        cwd: p.cwd,
                        task_count: p.task_count,
                        active_count: p.active_count,
                        completed_count: p.completed_count,
                    },
                    updated_at: (_g = p.last_active_at) !== null && _g !== void 0 ? _g : undefined,
                });
            }),
        });
    }
    return { columns };
}
export async function fetchProjectBoard(params) {
    const raw = await apiClient.get(`/api/kanban/projects${buildQuery(params)}`);
    return normalizeProjectBoard(raw);
}
// ── 会话看板 ────────────────────────────────────────────────
// 后端返回：{ groups: { agent: { status: [task...] } } }
// 任务项：{ id, prompt, status, agent_id, session_id, chat_id, cwd, created_at, started_at, completed_at }
const SESSION_COLUMN_ORDER = [
    "queued",
    "running",
    "review",
    "completed",
    "failed",
    "stopped",
];
const SESSION_COLUMN_TITLES = {
    queued: "排队",
    running: "运行中",
    review: "待审",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止",
};
function normalizeSessionBoard(raw) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!raw)
        return { columns: [] };
    if (Array.isArray(raw.columns))
        return { columns: raw.columns };
    const buckets = {};
    for (const key of SESSION_COLUMN_ORDER)
        buckets[key] = [];
    const groups = (_a = raw.groups) !== null && _a !== void 0 ? _a : {};
    for (const [agent, agentBuckets] of Object.entries(groups)) {
        if (!agentBuckets || typeof agentBuckets !== "object")
            continue;
        for (const [status, items] of Object.entries(agentBuckets)) {
            if (!Array.isArray(items))
                continue;
            if (!buckets[status])
                buckets[status] = [];
            for (const t of items) {
                buckets[status].push({
                    id: String((_b = t.id) !== null && _b !== void 0 ? _b : ""),
                    title: (_c = t.prompt) !== null && _c !== void 0 ? _c : String((_d = t.id) !== null && _d !== void 0 ? _d : ""),
                    status,
                    type: "session",
                    metadata: {
                        agent_id: (_e = t.agent_id) !== null && _e !== void 0 ? _e : agent,
                        session_id: t.session_id,
                        chat_id: t.chat_id,
                        cwd: t.cwd,
                    },
                    created_at: (_f = t.created_at) !== null && _f !== void 0 ? _f : undefined,
                    updated_at: (_j = (_h = (_g = t.completed_at) !== null && _g !== void 0 ? _g : t.started_at) !== null && _h !== void 0 ? _h : t.created_at) !== null && _j !== void 0 ? _j : undefined,
                });
            }
        }
    }
    const columns = SESSION_COLUMN_ORDER.map((key) => {
        var _a, _b;
        return ({
            id: key,
            title: (_a = SESSION_COLUMN_TITLES[key]) !== null && _a !== void 0 ? _a : key,
            cards: (_b = buckets[key]) !== null && _b !== void 0 ? _b : [],
        });
    });
    return { columns };
}
export async function fetchSessionBoard(params) {
    const raw = await apiClient.get(`/api/kanban/sessions${buildQuery(params)}`);
    return normalizeSessionBoard(raw);
}
// ── Agent 看板 ─────────────────────────────────────────────
// 后端返回：{ swimlanes: { agent: { running: [], queued: [], review: [], completed: [], failed: [], idle: bool } } }
const AGENT_LANE_COLUMNS = [
    "queued",
    "running",
    "review",
    "completed",
    "failed",
];
const AGENT_LANE_TITLES = {
    queued: "排队",
    running: "运行中",
    review: "待审",
    completed: "已完成",
    failed: "失败",
};
function normalizeAgentBoard(raw) {
    if (!raw)
        return [];
    if (Array.isArray(raw))
        return raw;
    const swimlanes = raw.swimlanes;
    if (!swimlanes || typeof swimlanes !== "object")
        return [];
    return Object.entries(swimlanes).map(([agent, lane]) => {
        const safeLane = (lane && typeof lane === "object" ? lane : {});
        return {
            agent,
            idle: !!safeLane.idle,
            columns: AGENT_LANE_COLUMNS.map((key) => {
                var _a;
                return ({
                    id: `${agent}:${key}`,
                    title: (_a = AGENT_LANE_TITLES[key]) !== null && _a !== void 0 ? _a : key,
                    cards: (Array.isArray(safeLane[key]) ? safeLane[key] : []).map((t) => {
                        var _a, _b, _c, _d, _e, _f, _g, _h;
                        return ({
                            id: String((_a = t.id) !== null && _a !== void 0 ? _a : ""),
                            title: (_b = t.prompt) !== null && _b !== void 0 ? _b : String((_c = t.id) !== null && _c !== void 0 ? _c : ""),
                            status: key,
                            type: "task",
                            metadata: {
                                agent_id: (_d = t.agent_id) !== null && _d !== void 0 ? _d : agent,
                                session_id: t.session_id,
                                cwd: t.cwd,
                                duration_ms: t.duration_ms,
                            },
                            created_at: (_e = t.created_at) !== null && _e !== void 0 ? _e : undefined,
                            updated_at: (_h = (_g = (_f = t.completed_at) !== null && _f !== void 0 ? _f : t.started_at) !== null && _g !== void 0 ? _g : t.created_at) !== null && _h !== void 0 ? _h : undefined,
                        });
                    }),
                });
            }),
        };
    });
}
export async function fetchAgentBoard(params) {
    const raw = await apiClient.get(`/api/kanban/agents${buildQuery(params)}`);
    return normalizeAgentBoard(raw);
}
// ── 工作流看板 ─────────────────────────────────────────────
// 后端返回：{ groups: { run_id: { workflow_id, workflow_name, run_status, pending: [], running: [], completed: [], failed: [] } } }
const WORKFLOW_COLUMN_ORDER = ["pending", "running", "completed", "failed"];
const WORKFLOW_COLUMN_TITLES = {
    pending: "等待中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
};
function normalizeWorkflowBoard(raw) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    if (!raw)
        return { columns: [] };
    if (Array.isArray(raw.columns))
        return { columns: raw.columns };
    const buckets = {};
    for (const key of WORKFLOW_COLUMN_ORDER)
        buckets[key] = [];
    const groups = (_a = raw.groups) !== null && _a !== void 0 ? _a : {};
    for (const [runId, run] of Object.entries(groups)) {
        if (!run || typeof run !== "object")
            continue;
        const runRef = run;
        const workflowName = (_c = (_b = runRef.workflow_name) !== null && _b !== void 0 ? _b : runRef.workflow_id) !== null && _c !== void 0 ? _c : String(runId);
        for (const key of WORKFLOW_COLUMN_ORDER) {
            const items = Array.isArray(runRef[key]) ? runRef[key] : [];
            for (const node of items) {
                buckets[key].push({
                    id: String((_e = (_d = node.node_run_id) !== null && _d !== void 0 ? _d : node.node_id) !== null && _e !== void 0 ? _e : ""),
                    title: `${workflowName} / ${(_f = node.node_id) !== null && _f !== void 0 ? _f : ""}`,
                    status: (_g = node.status) !== null && _g !== void 0 ? _g : key,
                    type: "workflow_node",
                    metadata: {
                        run_id: runId,
                        workflow_id: runRef.workflow_id,
                        workflow_name: runRef.workflow_name,
                        node_id: node.node_id,
                        task_id: node.task_id,
                        error: node.error,
                    },
                    created_at: (_h = node.started_at) !== null && _h !== void 0 ? _h : undefined,
                    updated_at: (_k = (_j = node.completed_at) !== null && _j !== void 0 ? _j : node.started_at) !== null && _k !== void 0 ? _k : undefined,
                });
            }
        }
    }
    const columns = WORKFLOW_COLUMN_ORDER.map((key) => {
        var _a, _b;
        return ({
            id: key,
            title: (_a = WORKFLOW_COLUMN_TITLES[key]) !== null && _a !== void 0 ? _a : key,
            cards: (_b = buckets[key]) !== null && _b !== void 0 ? _b : [],
        });
    });
    return { columns };
}
export async function fetchWorkflowBoard(params) {
    const raw = await apiClient.get(`/api/kanban/workflows${buildQuery(params)}`);
    return normalizeWorkflowBoard(raw);
}
export function moveCard(input) {
    return apiClient.post("/api/kanban/move", input);
}
//# sourceMappingURL=kanban.js.map