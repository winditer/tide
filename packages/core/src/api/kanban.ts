import { apiClient } from "./client";
import type {
  KanbanBoard,
  KanbanCard,
  KanbanColumn,
  AgentSwimlane,
  MoveCardInput,
} from "../types/kanban";

export interface KanbanQueryParams {
  workspace_id?: string;
}

function buildQuery(params?: KanbanQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params?.workspace_id) searchParams.set("workspace_id", params.workspace_id);
  const q = searchParams.toString();
  return q ? `?${q}` : "";
}

// ── 项目看板 ────────────────────────────────────────────────
// 后端返回：{ columns: { active: [...], completed: [...], archived: [...] } }
// 每个项目项：{ id, name, cwd, task_count, active_count, completed_count, status, last_active_at }

const PROJECT_COLUMN_ORDER = ["active", "completed", "archived"] as const;
const PROJECT_COLUMN_TITLES: Record<string, string> = {
  active: "进行中",
  completed: "已完成",
  archived: "已归档",
};

interface RawProjectBoard {
  columns?: Record<string, any[]> | KanbanColumn[];
}

function normalizeProjectBoard(raw: RawProjectBoard | null | undefined): KanbanBoard {
  if (!raw || !raw.columns) return { columns: [] };

  // 已经是数组格式（前端期望形态），直接透传
  if (Array.isArray(raw.columns)) {
    return { columns: raw.columns as KanbanColumn[] };
  }

  const columnsMap = raw.columns as Record<string, any[]>;
  const columns: KanbanColumn[] = PROJECT_COLUMN_ORDER.filter((key) =>
    Array.isArray(columnsMap[key])
  ).map((key) => ({
    id: key,
    title: PROJECT_COLUMN_TITLES[key] ?? key,
    cards: (columnsMap[key] ?? []).map<KanbanCard>((p) => ({
      id: String(p.id ?? p.cwd ?? ""),
      title: p.name ?? p.cwd ?? String(p.id ?? ""),
      status: p.status ?? key,
      type: "project",
      metadata: {
        cwd: p.cwd,
        task_count: p.task_count,
        active_count: p.active_count,
        completed_count: p.completed_count,
        archived: !!p.archived,
        work_item_stats: p.work_item_stats,
        members: p.members,
        workflow_name: p.workflow_name,
        versions_count: p.versions_count,
        active_version: p.active_version,
        last_activity: p.last_activity,
        health: p.health,
      },
      updated_at: p.last_active_at ?? undefined,
    })),
  }));

  // 将 PROJECT_COLUMN_ORDER 之外的额外列也保留下来
  for (const [key, items] of Object.entries(columnsMap)) {
    if ((PROJECT_COLUMN_ORDER as readonly string[]).includes(key)) continue;
    if (!Array.isArray(items)) continue;
    columns.push({
      id: key,
      title: PROJECT_COLUMN_TITLES[key] ?? key,
      cards: items.map<KanbanCard>((p) => ({
        id: String(p.id ?? p.cwd ?? ""),
        title: p.name ?? p.cwd ?? String(p.id ?? ""),
        status: p.status ?? key,
        type: "project",
        metadata: {
          cwd: p.cwd,
          task_count: p.task_count,
          active_count: p.active_count,
          completed_count: p.completed_count,
          archived: !!p.archived,
          work_item_stats: p.work_item_stats,
          members: p.members,
          workflow_name: p.workflow_name,
          versions_count: p.versions_count,
          active_version: p.active_version,
          last_activity: p.last_activity,
          health: p.health,
        },
        updated_at: p.last_active_at ?? undefined,
      })),
    });
  }

  return { columns };
}

export async function fetchProjectBoard(
  params?: KanbanQueryParams
): Promise<KanbanBoard> {
  const raw = await apiClient.get<RawProjectBoard>(
    `/api/kanban/projects${buildQuery(params)}`
  );
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
] as const;
const SESSION_COLUMN_TITLES: Record<string, string> = {
  queued: "排队",
  running: "运行中",
  review: "待审",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
};

interface RawSessionBoard {
  groups?: Record<string, Record<string, any[]>>;
  columns?: KanbanColumn[];
}

function normalizeSessionBoard(raw: RawSessionBoard | null | undefined): KanbanBoard {
  if (!raw) return { columns: [] };
  if (Array.isArray(raw.columns)) return { columns: raw.columns };

  const buckets: Record<string, KanbanCard[]> = {};
  for (const key of SESSION_COLUMN_ORDER) buckets[key] = [];

  const seenIds = new Set<string>();

  const groups = raw.groups ?? {};
  for (const [agent, agentBuckets] of Object.entries(groups)) {
    if (!agentBuckets || typeof agentBuckets !== "object") continue;
    for (const [status, items] of Object.entries(agentBuckets)) {
      if (!Array.isArray(items)) continue;
      if (!buckets[status]) buckets[status] = [];
      for (const t of items) {
        let cardId = String(t.id ?? "");
        if (seenIds.has(cardId)) {
          let idx = 2;
          while (seenIds.has(`${cardId}_${idx}`)) idx++;
          cardId = `${cardId}_${idx}`;
        }
        seenIds.add(cardId);

        buckets[status].push({
          id: cardId,
          title: t.prompt ?? String(t.id ?? ""),
          status,
          type: "session",
          metadata: {
            agent_id: t.agent_id ?? agent,
            session_id: t.session_id,
            chat_id: t.chat_id,
            cwd: t.cwd,
          },
          created_at: t.created_at ?? undefined,
          updated_at: t.completed_at ?? t.started_at ?? t.created_at ?? undefined,
        });
      }
    }
  }

  const columns: KanbanColumn[] = SESSION_COLUMN_ORDER.map((key) => ({
    id: key,
    title: SESSION_COLUMN_TITLES[key] ?? key,
    cards: buckets[key] ?? [],
  }));

  return { columns };
}

export async function fetchSessionBoard(
  params?: KanbanQueryParams
): Promise<KanbanBoard> {
  const raw = await apiClient.get<RawSessionBoard>(
    `/api/kanban/sessions${buildQuery(params)}`
  );
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
] as const;
const AGENT_LANE_TITLES: Record<string, string> = {
  queued: "排队",
  running: "运行中",
  review: "待审",
  completed: "已完成",
  failed: "失败",
};

interface RawAgentBoard {
  swimlanes?: Record<string, any>;
}

function normalizeAgentBoard(
  raw: RawAgentBoard | AgentSwimlane[] | null | undefined
): AgentSwimlane[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  const swimlanes = raw.swimlanes;
  if (!swimlanes || typeof swimlanes !== "object") return [];

  return Object.entries(swimlanes).map(([agent, lane]) => {
    const safeLane = (lane && typeof lane === "object" ? lane : {}) as Record<
      string,
      any
    >;
    return {
      agent,
      idle: !!safeLane.idle,
      columns: AGENT_LANE_COLUMNS.map((key) => ({
        id: `${agent}:${key}`,
        title: AGENT_LANE_TITLES[key] ?? key,
        cards: (Array.isArray(safeLane[key]) ? safeLane[key] : []).map<KanbanCard>(
          (t: any) => ({
            id: String(t.id ?? ""),
            title: t.prompt ?? String(t.id ?? ""),
            status: key,
            type: "task",
            metadata: {
              agent_id: t.agent_id ?? agent,
              session_id: t.session_id,
              cwd: t.cwd,
              duration_ms: t.duration_ms,
            },
            created_at: t.created_at ?? undefined,
            updated_at:
              t.completed_at ?? t.started_at ?? t.created_at ?? undefined,
          })
        ),
      })),
    };
  });
}

export async function fetchAgentBoard(
  params?: KanbanQueryParams
): Promise<AgentSwimlane[]> {
  const raw = await apiClient.get<RawAgentBoard>(
    `/api/kanban/agents${buildQuery(params)}`
  );
  return normalizeAgentBoard(raw);
}

// ── 工作流看板 ─────────────────────────────────────────────
// 后端返回：{ groups: { run_id: { workflow_id, workflow_name, run_status, pending: [], running: [], completed: [], failed: [] } } }

const WORKFLOW_COLUMN_ORDER = ["pending", "running", "completed", "failed"] as const;
const WORKFLOW_COLUMN_TITLES: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

interface RawWorkflowBoard {
  groups?: Record<string, any>;
  columns?: KanbanColumn[];
}

function normalizeWorkflowBoard(
  raw: RawWorkflowBoard | null | undefined
): KanbanBoard {
  if (!raw) return { columns: [] };
  if (Array.isArray(raw.columns)) return { columns: raw.columns };

  const buckets: Record<string, KanbanCard[]> = {};
  for (const key of WORKFLOW_COLUMN_ORDER) buckets[key] = [];

  const groups = raw.groups ?? {};
  for (const [runId, run] of Object.entries(groups)) {
    if (!run || typeof run !== "object") continue;
    const runRef = run as Record<string, any>;
    const workflowName =
      runRef.workflow_name ?? runRef.workflow_id ?? String(runId);
    for (const key of WORKFLOW_COLUMN_ORDER) {
      const items = Array.isArray(runRef[key]) ? runRef[key] : [];
      for (const node of items) {
        buckets[key].push({
          id: String(node.node_run_id ?? node.node_id ?? ""),
          title: `${workflowName} / ${node.node_id ?? ""}`,
          status: node.status ?? key,
          type: "workflow_node",
          metadata: {
            run_id: runId,
            workflow_id: runRef.workflow_id,
            workflow_name: runRef.workflow_name,
            node_id: node.node_id,
            task_id: node.task_id,
            error: node.error,
          },
          created_at: node.started_at ?? undefined,
          updated_at: node.completed_at ?? node.started_at ?? undefined,
        });
      }
    }
  }

  const columns: KanbanColumn[] = WORKFLOW_COLUMN_ORDER.map((key) => ({
    id: key,
    title: WORKFLOW_COLUMN_TITLES[key] ?? key,
    cards: buckets[key] ?? [],
  }));

  return { columns };
}

export async function fetchWorkflowBoard(
  params?: KanbanQueryParams
): Promise<KanbanBoard> {
  const raw = await apiClient.get<RawWorkflowBoard>(
    `/api/kanban/workflows${buildQuery(params)}`
  );
  return normalizeWorkflowBoard(raw);
}

export function moveCard(input: MoveCardInput): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>("/api/kanban/move", input);
}
