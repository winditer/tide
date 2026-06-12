"""
KanbanService — 四维看板数据聚合。

提供项目看板、会话看板、Agent 看板、工作流看板的聚合查询，
以及拖拽状态变更操作。

数据源：
- DB tasks / workflow_runs / workflow_node_runs 表（结构化执行数据）
- backend.services.project_discovery / session_discovery（本地 Agent 会话文件扫描）

返回结构与前端 packages/core/src/api/kanban.ts 中的 normalize 逻辑兼容：
- 项目看板：{ columns: { active|completed|archived: [project_card, ...] } }
- 会话看板：{ groups:  { agent: { queued|running|completed|...: [task_card, ...] } } }
- Agent 看板：{ swimlanes: { agent: { running|queued|review|completed|failed: [...], idle: bool } } }
- 工作流看板：{ groups: { run_id: { workflow_id, workflow_name, run_status,
                                    pending|running|completed|failed: [...] } } }
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from backend.db.engine import async_session_factory
from backend.services.archive_service import archive_store
from backend.services.event_emitter import event_emitter
from backend.services.project_discovery import discover_projects
from backend.services.session_discovery import discover_sessions


def _encode_project_id(cwd: str) -> str:
    """与 backend/api/projects.py 中 ``_encode_id`` 保持一致的 URL-safe base64 编码。

    归档状态以编码后的 project_id 作键，故看板需用相同编码才能正确匹配。
    """
    import base64

    return base64.urlsafe_b64encode((cwd or "").encode()).decode().rstrip("=")


# 已知 Agent 列表（兜底，避免某 Agent 无任务时不出现在看板）
KNOWN_AGENTS = ["codex", "claude", "qoder"]

# 任务状态分桶
TASK_STATUS_COLUMNS = ["queued", "running", "review", "completed", "failed", "stopped"]

# 项目"活跃"窗口（天）
PROJECT_ACTIVE_WINDOW_DAYS = 7

ACTIVE_STATUSES = ("running", "queued", "review")
DONE_STATUSES = ("completed", "failed", "stopped", "rejected", "approved")


# ── 时间工具 ────────────────────────────────────────────


def _parse_iso(value: Any) -> Optional[datetime]:
    """将多种来源的时间字段解析为 naive datetime（统一视为 UTC，便于比较）。"""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    s = str(value).strip()
    if not s:
        return None
    # 尝试 ISO 格式（含 Z）
    try:
        s2 = s[:-1] + "+00:00" if s.endswith("Z") else s
        dt = datetime.fromisoformat(s2)
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    except ValueError:
        pass
    # 尝试 SQLite "YYYY-MM-DD HH:MM:SS"
    try:
        return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _max_dt(a: Optional[datetime], b: Optional[datetime]) -> Optional[datetime]:
    if a is None:
        return b
    if b is None:
        return a
    return a if a >= b else b


def _to_iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    try:
        return dt.isoformat()
    except (ValueError, OverflowError):
        return None


class KanbanService:
    # ── 项目看板 ────────────────────────────────────────────

    async def get_project_board(self, workspace_id: str = "default") -> dict:
        """项目看板：合并本地扫描发现的项目与 DB tasks 聚合。

        分列规则：
        - archived:  被用户软归档（archive_store 中标记），无论活跃度如何均归此列
        - active:    存在运行中任务，或最近 7 天活跃
        - completed: 无运行中任务，且超过 7 天未活跃，但有过任务/会话
        - archived:  其他（无任何活动痕迹）
        """
        # 1) 本地项目扫描（同步函数 → 线程池）
        try:
            discovered: list[dict] = await asyncio.to_thread(discover_projects)
        except Exception:
            discovered = []

        # 2) DB 聚合
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT cwd,
                           COUNT(*) AS task_count,
                           SUM(CASE WHEN status IN ('running', 'queued', 'review') THEN 1 ELSE 0 END) AS active_count,
                           SUM(CASE WHEN status IN ('completed', 'failed', 'stopped', 'rejected', 'approved') THEN 1 ELSE 0 END) AS done_count,
                           MAX(created_at) AS last_active_at
                    FROM tasks
                    WHERE workspace_id = :ws AND cwd IS NOT NULL AND cwd <> ''
                    GROUP BY cwd
                    """
                ),
                {"ws": workspace_id},
            )
            db_rows = [dict(r._mapping) for r in result.fetchall()]

        # 3) 合并：以 cwd 作为项目唯一键
        merged: dict[str, dict] = {}

        # 3.1 来自本地扫描
        for proj in discovered:
            cwd = proj.get("cwd") or proj.get("id")
            if not cwd:
                continue
            merged[cwd] = {
                "id": str(proj.get("id") or cwd),
                "name": proj.get("name") or cwd.rstrip("/").split("/")[-1] or cwd,
                "cwd": cwd,
                "task_count": 0,
                "active_count": 0,
                "completed_count": 0,
                "session_count": int(proj.get("task_count") or 0),  # 文件扫描出的会话数
                "agents": list(proj.get("agents") or []),
                "_last_active_dt": _parse_iso(proj.get("last_active")),
            }

        # 3.2 合入 DB tasks 聚合
        for row in db_rows:
            cwd = row.get("cwd")
            if not cwd:
                continue
            entry = merged.get(cwd)
            if entry is None:
                entry = {
                    "id": cwd,
                    "name": cwd.rstrip("/").split("/")[-1] or cwd,
                    "cwd": cwd,
                    "task_count": 0,
                    "active_count": 0,
                    "completed_count": 0,
                    "session_count": 0,
                    "agents": [],
                    "_last_active_dt": None,
                }
                merged[cwd] = entry
            entry["task_count"] = int(row.get("task_count") or 0)
            entry["active_count"] = int(row.get("active_count") or 0)
            entry["completed_count"] = int(row.get("done_count") or 0)
            entry["_last_active_dt"] = _max_dt(
                entry["_last_active_dt"], _parse_iso(row.get("last_active_at"))
            )

        # 4) 状态分列
        now = datetime.utcnow()
        threshold = now - timedelta(days=PROJECT_ACTIVE_WINDOW_DAYS)
        columns: dict[str, list[dict]] = {"active": [], "completed": [], "archived": []}
        archived_ids = set(archive_store.list_archived_projects())

        for cwd, entry in merged.items():
            last_dt = entry.pop("_last_active_dt", None)
            # 用与项目 API 一致的编码 id，便于前端与归档/拖拽接口对应
            project_id = _encode_project_id(cwd)
            entry["id"] = project_id
            is_archived = project_id in archived_ids
            entry["archived"] = is_archived
            if is_archived:
                status = "archived"
            elif entry["active_count"] > 0:
                status = "active"
            elif last_dt and last_dt >= threshold:
                status = "active"
            elif (entry["task_count"] > 0 or entry["session_count"] > 0) and (
                last_dt is None or last_dt < threshold
            ):
                status = "completed"
            else:
                status = "archived"
            entry["status"] = status
            entry["last_active_at"] = _to_iso(last_dt)
            columns[status].append(entry)

        # 5) 按 last_active_at 倒序
        for col in columns.values():
            col.sort(key=lambda x: x.get("last_active_at") or "", reverse=True)

        # 6) 为每个项目附加丰富数据（工作项统计、成员、工作流、版本、健康度）
        all_projects = []
        for col in columns.values():
            all_projects.extend(col)
        await self._enrich_project_cards(all_projects)

        return {"columns": columns}

    # ── 项目卡片数据丰富化 ─────────────────────────────────────

    async def _enrich_project_cards(self, projects: list[dict]) -> None:
        """为项目卡片补充工作项统计、成员、工作流、版本和健康度数据。"""
        if not projects:
            return

        # 收集所有 project_id
        project_ids = [p["id"] for p in projects]

        try:
            async with async_session_factory() as session:
                # ── 工作项统计 ──
                work_item_stats = await self._query_work_item_stats(session, project_ids)
                # ── 成员 ──
                members_map = await self._query_project_members(session, project_ids)
                # ── 工作流绑定 ──
                workflow_map = await self._query_project_workflows(session, project_ids)
                # ── 版本 ──
                version_map = await self._query_project_versions(session, project_ids)
        except Exception:
            work_item_stats = {}
            members_map = {}
            workflow_map = {}
            version_map = {}

        now = datetime.utcnow()
        for p in projects:
            pid = p["id"]

            # 工作项统计
            stats = work_item_stats.get(pid, {"total": 0, "completed": 0, "stale_count": 0})
            p["work_item_stats"] = stats

            # 成员（最多5个）
            p["members"] = members_map.get(pid, [])[:5]

            # 工作流名称
            wf_info = workflow_map.get(pid)
            p["workflow_name"] = wf_info["name"] if wf_info else None

            # 版本信息
            ver_info = version_map.get(pid, {})
            p["versions_count"] = ver_info.get("count", 0)
            p["active_version"] = ver_info.get("active_name")

            # 最近活动时间
            last_activity_str = p.get("last_active_at")
            last_activity_dt = _parse_iso(last_activity_str)
            p["last_activity"] = last_activity_str

            # 健康度
            p["health"] = self._calc_health(
                stats["total"], stats["completed"], stats["stale_count"], last_activity_dt, now
            )

    @staticmethod
    def _calc_health(
        total: int, completed: int, stale_count: int,
        last_activity: Optional[datetime], now: datetime
    ) -> str:
        """计算项目健康度。green/yellow/red。"""
        if total == 0:
            return "green"
        incomplete = total - completed
        if incomplete == 0:
            return "green"
        stale_ratio = stale_count / incomplete if incomplete > 0 else 0

        # 7天无活动 → 红
        days_inactive = (now - last_activity).days if last_activity else 999
        if days_inactive >= 7:
            return "red"
        # 超过50%滞留 → 红
        if stale_ratio >= 0.5:
            return "red"
        # 有滞留项 → 黄
        if stale_count > 0:
            return "yellow"
        return "green"

    async def _query_work_item_stats(
        self, session: Any, project_ids: list[str]
    ) -> dict[str, dict]:
        """查询每个项目的工作项统计（total, completed, stale_count）。"""
        try:
            result = await session.execute(
                text(
                    """
                    SELECT project_id,
                           COUNT(*) AS total,
                           SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
                           SUM(CASE WHEN completed_at IS NULL
                                    AND updated_at < datetime('now', '-3 days')
                               THEN 1 ELSE 0 END) AS stale_count
                    FROM work_items
                    WHERE project_id IN (SELECT value FROM json_each(:ids))
                    GROUP BY project_id
                    """
                ),
                {"ids": json.dumps(project_ids)}
            )
            stats = {}
            for row in result.fetchall():
                r = dict(row._mapping)
                stats[r["project_id"]] = {
                    "total": int(r.get("total") or 0),
                    "completed": int(r.get("completed") or 0),
                    "stale_count": int(r.get("stale_count") or 0),
                }
            return stats
        except OperationalError:
            return {}

    async def _query_project_members(
        self, session: Any, project_ids: list[str]
    ) -> dict[str, list[dict]]:
        """查询每个项目的成员列表（最多5个）。"""
        try:
            result = await session.execute(
                text(
                    """
                    SELECT pm.project_id, u.id AS user_id, u.display_name
                    FROM project_members pm
                    JOIN users u ON u.id = pm.user_id
                    WHERE pm.project_id IN (SELECT value FROM json_each(:ids))
                    ORDER BY pm.created_at ASC
                    """
                ),
                {"ids": json.dumps(project_ids)}
            )
            members: dict[str, list[dict]] = {}
            for row in result.fetchall():
                r = dict(row._mapping)
                pid = r["project_id"]
                if pid not in members:
                    members[pid] = []
                if len(members[pid]) < 5:
                    members[pid].append({
                        "user_id": r["user_id"],
                        "display_name": r.get("display_name") or "?",
                    })
            return members
        except OperationalError:
            return {}

    async def _query_project_workflows(
        self, session: Any, project_ids: list[str]
    ) -> dict[str, dict]:
        """查询项目绑定的工作流名称。"""
        try:
            result = await session.execute(
                text(
                    """
                    SELECT ps.project_id, w.name AS workflow_name
                    FROM project_settings ps
                    JOIN workflows w ON w.id = ps.workflow_id
                    WHERE ps.project_id IN (SELECT value FROM json_each(:ids))
                      AND ps.workflow_id IS NOT NULL
                    """
                ),
                {"ids": json.dumps(project_ids)}
            )
            wf_map = {}
            for row in result.fetchall():
                r = dict(row._mapping)
                wf_map[r["project_id"]] = {"name": r.get("workflow_name")}
            return wf_map
        except OperationalError:
            return {}

    async def _query_project_versions(
        self, session: Any, project_ids: list[str]
    ) -> dict[str, dict]:
        """查询每个项目的版本数量和当前活跃版本。"""
        try:
            result = await session.execute(
                text(
                    """
                    SELECT project_id,
                           COUNT(*) AS versions_count,
                           MAX(CASE WHEN status = 'active' THEN name END) AS active_version_name
                    FROM versions
                    WHERE project_id IN (SELECT value FROM json_each(:ids))
                    GROUP BY project_id
                    """
                ),
                {"ids": json.dumps(project_ids)}
            )
            ver_map = {}
            for row in result.fetchall():
                r = dict(row._mapping)
                ver_map[r["project_id"]] = {
                    "count": int(r.get("versions_count") or 0),
                    "active_name": r.get("active_version_name"),
                }
            return ver_map
        except OperationalError:
            return {}

    # ── 会话看板 ────────────────────────────────────────────

    async def get_session_board(self, workspace_id: str = "default") -> dict:
        """会话看板：合并 DB tasks 与本地扫描会话，按 Agent 分组、按状态分列。

        - DB 任务保留原状态（queued/running/review/completed/failed/stopped）
        - 本地扫描会话：若与某 DB 任务的 session_id 匹配则跳过（避免重复），
          否则归入 completed 列（视为历史已完成会话）
        """
        # 1) DB tasks — 只取有 session_id 的（代表真实 agent 会话）
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, prompt, status, agent_id, session_id,
                           chat_id, cwd, created_at, started_at, completed_at
                    FROM tasks
                    WHERE workspace_id = :ws
                      AND session_id IS NOT NULL AND session_id != ''
                    ORDER BY created_at DESC
                    LIMIT 500
                    """
                ),
                {"ws": workspace_id},
            )
            db_tasks = [dict(r._mapping) for r in result.fetchall()]

        # 2) 本地扫描会话（同步 → 线程池）
        try:
            file_sessions: list[dict] = await asyncio.to_thread(discover_sessions)
        except Exception:
            file_sessions = []

        # 3) 已 in DB 的 session_id 集合，用于去重
        db_session_ids = {
            t.get("session_id") for t in db_tasks if t.get("session_id")
        }

        # 4) 构建 groups
        groups: dict[str, dict[str, list[dict]]] = {}
        for agent in KNOWN_AGENTS:
            groups[agent] = {col: [] for col in TASK_STATUS_COLUMNS}

        # 4.1 DB tasks — 只保留有 session_id 的（代表真实 agent 会话）
        for t in db_tasks:
            if not t.get("session_id"):
                continue  # 跳过无 session 的纯任务（如 Plan 子任务）
            agent = t.get("agent_id") or "codex"
            if agent not in groups:
                groups[agent] = {col: [] for col in TASK_STATUS_COLUMNS}
            status = t.get("status") or "queued"
            if status not in groups[agent]:
                groups[agent][status] = []
            groups[agent][status].append(
                {
                    "id": f"db:{t['id']}",
                    "prompt": t.get("prompt"),
                    "status": status,
                    "agent_id": agent,
                    "session_id": t.get("session_id"),
                    "chat_id": t.get("chat_id"),
                    "cwd": t.get("cwd"),
                    "created_at": t.get("created_at"),
                    "started_at": t.get("started_at"),
                    "completed_at": t.get("completed_at"),
                    "source": "db",
                }
            )

        # 4.2 本地扫描会话（去重后归入 completed）
        for s in file_sessions:
            sid = s.get("session_id") or s.get("id")
            if not sid or sid in db_session_ids:
                continue
            agent = s.get("agent_id") or "codex"
            if agent not in groups:
                groups[agent] = {col: [] for col in TASK_STATUS_COLUMNS}
            if "completed" not in groups[agent]:
                groups[agent]["completed"] = []
            groups[agent]["completed"].append(
                {
                    "id": f"file:{sid}",
                    "prompt": s.get("title") or str(sid),
                    "status": "completed",
                    "agent_id": agent,
                    "session_id": str(sid),
                    "chat_id": None,
                    "cwd": s.get("cwd"),
                    "created_at": s.get("created_at"),
                    "started_at": s.get("created_at"),
                    "completed_at": s.get("last_active"),
                    "source": "file",
                }
            )

        # 5) 每个状态最多 50 条，避免响应过大
        for agent_groups in groups.values():
            for key, items in list(agent_groups.items()):
                if isinstance(items, list):
                    agent_groups[key] = items[:50]

        return {"groups": groups}

    # ── Agent 看板 ──────────────────────────────────────────

    async def get_agent_board(self, workspace_id: str = "default") -> dict:
        """Agent 看板：每个 Agent 一条泳道，泳道内按状态分列。

        数据源：
        - DB tasks：实时执行的任务（queued/running/review/completed/failed/stopped）
        - 本地扫描会话（discover_sessions）：历史完成会话，按 agent_id 聚合到 completed 列

        泳道列：running / queued / review / completed / failed
        idle = 无 running/queued/review 任务
        """
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, prompt, status, agent_id, session_id,
                           cwd, created_at, started_at, completed_at, duration_ms
                    FROM tasks
                    WHERE workspace_id = :ws
                      AND status IN ('queued', 'running', 'review', 'completed', 'failed', 'stopped')
                    ORDER BY created_at DESC
                    LIMIT 500
                    """
                ),
                {"ws": workspace_id},
            )
            rows = [dict(r._mapping) for r in result.fetchall()]

        # 本地扫描会话（同步 → 线程池），用于补充历史已完成会话
        try:
            file_sessions: list[dict] = await asyncio.to_thread(discover_sessions)
        except Exception:
            file_sessions = []

        swimlanes: dict[str, dict] = {}

        def _new_lane() -> dict:
            return {
                "running": [],
                "queued": [],
                "review": [],
                "completed": [],
                "failed": [],
                "idle": True,
            }

        for agent in KNOWN_AGENTS:
            swimlanes[agent] = _new_lane()

        db_session_ids: set[str] = set()
        for row in rows:
            agent = row.get("agent_id") or "codex"
            if agent not in swimlanes:
                swimlanes[agent] = _new_lane()
            lane = swimlanes[agent]
            status = row.get("status") or "queued"
            if row.get("session_id"):
                db_session_ids.add(str(row["session_id"]))
            card = {
                "id": row["id"],
                "prompt": row.get("prompt"),
                "status": status,
                "agent_id": agent,
                "session_id": row.get("session_id"),
                "cwd": row.get("cwd"),
                "created_at": row.get("created_at"),
                "started_at": row.get("started_at"),
                "completed_at": row.get("completed_at"),
                "duration_ms": row.get("duration_ms"),
                "source": "db",
            }
            if status == "running":
                lane["running"].append(card)
                lane["idle"] = False
            elif status == "review":
                lane["review"].append(card)
                lane["idle"] = False
            elif status == "queued":
                lane["queued"].append(card)
                lane["idle"] = False
            elif status == "completed":
                lane["completed"].append(card)
            elif status in ("failed", "stopped"):
                lane["failed"].append(card)

        # 合入本地扫描的历史会话（去重后归入 completed）
        for s in file_sessions:
            sid = s.get("session_id") or s.get("id")
            if not sid or str(sid) in db_session_ids:
                continue
            agent = s.get("agent_id") or "codex"
            if agent not in swimlanes:
                swimlanes[agent] = _new_lane()
            lane = swimlanes[agent]
            lane["completed"].append(
                {
                    "id": f"file:{sid}",
                    "prompt": s.get("title") or str(sid),
                    "status": "completed",
                    "agent_id": agent,
                    "session_id": str(sid),
                    "cwd": s.get("cwd"),
                    "created_at": s.get("created_at"),
                    "started_at": s.get("created_at"),
                    "completed_at": s.get("last_active"),
                    "duration_ms": None,
                    "source": "file",
                }
            )

        # 限制每个状态最多 20 条；completed 按 completed_at 倒序后截断
        for lane in swimlanes.values():
            if isinstance(lane.get("completed"), list):
                lane["completed"].sort(
                    key=lambda c: c.get("completed_at") or c.get("created_at") or "",
                    reverse=True,
                )
            for key in ("running", "queued", "review", "completed", "failed"):
                if isinstance(lane.get(key), list):
                    lane[key] = lane[key][:20]

        return {"swimlanes": swimlanes}

    # ── 工作流看板 ──────────────────────────────────────────

    async def get_workflow_board(self, workspace_id: str = "default") -> dict:
        """工作流任务看板：按 workflow_run 分组，节点按状态分列。

        若 workflow_runs / workflow_node_runs 表不存在或为空，返回空 groups。
        """
        rows: list[dict] = []
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    text(
                        """
                        SELECT wnr.id            AS node_run_id,
                               wnr.run_id        AS run_id,
                               wnr.node_id       AS node_id,
                               wnr.task_id       AS task_id,
                               wnr.status        AS node_status,
                               wnr.started_at    AS node_started_at,
                               wnr.completed_at  AS node_completed_at,
                               wnr.error         AS node_error,
                               wr.workflow_id    AS workflow_id,
                               wr.status         AS run_status,
                               wr.started_at     AS run_started_at,
                               wr.completed_at   AS run_completed_at,
                               w.name            AS workflow_name
                        FROM workflow_node_runs wnr
                        JOIN workflow_runs wr ON wr.id = wnr.run_id
                        JOIN workflows w      ON w.id = wr.workflow_id
                        WHERE wr.workspace_id = :ws
                        ORDER BY wr.started_at DESC, wnr.started_at ASC
                        """
                    ),
                    {"ws": workspace_id},
                )
                rows = [dict(r._mapping) for r in result.fetchall()]
        except OperationalError:
            # 表缺失 → 返回空
            return {"groups": {}}

        groups: dict[str, dict] = {}
        for row in rows:
            run_id = row["run_id"]
            if run_id not in groups:
                groups[run_id] = {
                    "run_id": run_id,
                    "workflow_id": row.get("workflow_id"),
                    "workflow_name": row.get("workflow_name"),
                    "run_status": row.get("run_status"),
                    "started_at": row.get("run_started_at"),
                    "completed_at": row.get("run_completed_at"),
                    "pending": [],
                    "running": [],
                    "completed": [],
                    "failed": [],
                }
            node_status = (row.get("node_status") or "pending").lower()
            card = {
                "node_run_id": row["node_run_id"],
                "node_id": row["node_id"],
                "task_id": row.get("task_id"),
                "status": node_status,
                "started_at": row.get("node_started_at"),
                "completed_at": row.get("node_completed_at"),
                "error": row.get("node_error"),
            }
            if node_status in ("pending", "queued", "waiting"):
                groups[run_id]["pending"].append(card)
            elif node_status in ("running", "in_progress"):
                groups[run_id]["running"].append(card)
            elif node_status in ("completed", "succeeded", "success"):
                groups[run_id]["completed"].append(card)
            elif node_status in ("failed", "error", "stopped", "cancelled"):
                groups[run_id]["failed"].append(card)
            else:
                groups[run_id]["pending"].append(card)

        return {"groups": groups}

    # ── 拖拽更新状态 ────────────────────────────────────────

    async def move_card(
        self,
        workspace_id: str,
        card_type: str,
        card_id: str,
        new_status: str,
    ) -> dict:
        """拖拽更新状态。

        card_type:
          - 'task'    → 更新 tasks.status，并广播 task.status_changed
          - 'session' → 视作单个任务（session_id 关联到 tasks.id），同 task
          - 'project' → 当前 DB 没有独立 projects 表，仅返回 acknowledged
        """
        if card_type in ("task", "session"):
            return await self._move_task(workspace_id, card_id, new_status)
        if card_type == "project":
            return {
                "ok": True,
                "card_type": "project",
                "card_id": card_id,
                "new_status": new_status,
                "note": "project status is derived from tasks; no persistent column update",
            }
        return {
            "ok": False,
            "error": f"unsupported card_type: {card_type}",
        }

    async def _move_task(
        self,
        workspace_id: str,
        task_id: str,
        new_status: str,
    ) -> dict:
        # 去除看板视图添加的 source 前缀
        if task_id.startswith("db:"):
            task_id = task_id[3:]
        elif task_id.startswith("file:"):
            task_id = task_id[5:]

        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT id, workspace_id, status FROM tasks WHERE id = :id"
                    ),
                    {"id": task_id},
                )
            ).fetchone()
            if not row:
                return {"ok": False, "error": "task not found", "card_id": task_id}

            old_status = row._mapping["status"]
            ws_id = row._mapping["workspace_id"] or workspace_id

            if old_status == new_status:
                return {
                    "ok": True,
                    "card_type": "task",
                    "card_id": task_id,
                    "old_status": old_status,
                    "new_status": new_status,
                    "noop": True,
                }

            await session.execute(
                text("UPDATE tasks SET status = :s WHERE id = :id"),
                {"s": new_status, "id": task_id},
            )
            await session.commit()

        await event_emitter.emit_task_status_changed(
            task_id, ws_id, old_status, new_status,
        )

        return {
            "ok": True,
            "card_type": "task",
            "card_id": task_id,
            "old_status": old_status,
            "new_status": new_status,
        }


kanban_service = KanbanService()
