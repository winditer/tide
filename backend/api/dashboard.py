import base64
import json
import logging
import os
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query
from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.session_discovery import discover_sessions

logger = logging.getLogger("tide.dashboard")

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ---------- 内部工具 ----------


def _encode_project_id(cwd: str) -> str:
    """与 backend/api/projects.py 保持一致的 base64 url-safe 编码。"""
    return base64.urlsafe_b64encode((cwd or "").encode()).decode().rstrip("=")


def _project_name_from_cwd(cwd: str) -> str:
    if not cwd:
        return "Unknown"
    return Path(cwd).name or cwd


def _load_registered_projects() -> dict[str, dict]:
    """读取 registered_projects.json，按 cwd 索引（容错：文件不存在/损坏返回空）。"""
    path = Path(
        os.getenv(
            "TIDE_PROJECTS_FILE",
            str(Path.home() / ".tide" / "registered_projects.json"),
        )
    ).expanduser()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        item["cwd"]: item
        for item in (data or [])
        if isinstance(item, dict) and item.get("cwd")
    }


@router.get("/stats")
async def get_stats(workspace_id: str = "default"):
    """统计数据：运行中 / 排队中 / 待审批 / 今日完成。

    数据源说明：
    - running / queued: DB ``tasks`` 表（仅 Web 工作台显式创建的任务进入 DB）。
    - pending_approval: DB ``approvals`` 表。
    - completed_today: 来自本地 Agent 会话文件发现 (session_discovery)，
      统计今日 ``last_active`` 的会话数（每完结一次对话即视为一次完成），
      并叠加 DB 中今日 ``completed_at`` 的任务数，避免双重数据源遗漏。
    """
    async with async_session_factory() as session:
        r = await session.execute(
            text("SELECT COUNT(*) FROM tasks WHERE workspace_id = :ws AND status = 'running'"),
            {"ws": workspace_id},
        )
        running = r.scalar() or 0

        r = await session.execute(
            text("SELECT COUNT(*) FROM tasks WHERE workspace_id = :ws AND status = 'queued'"),
            {"ws": workspace_id},
        )
        queued = r.scalar() or 0

        r = await session.execute(
            text(
                "SELECT COUNT(*) FROM approvals WHERE workspace_id = :ws AND status = 'pending'"
                " AND task_id IN (SELECT id FROM tasks WHERE status IN ('review', 'pending', 'running'))"
            ),
            {"ws": workspace_id},
        )
        pending_approval = r.scalar() or 0

        r = await session.execute(
            text(
                "SELECT COUNT(*) FROM tasks WHERE workspace_id = :ws"
                " AND status = 'completed' AND DATE(completed_at) = DATE('now')"
            ),
            {"ws": workspace_id},
        )
        db_completed_today = r.scalar() or 0

    # 今日完成 = DB 完成任务 + 今日 last_active 的本地 Agent 会话
    today_iso = date.today().isoformat()
    try:
        all_sessions = discover_sessions()
        file_completed_today = sum(
            1 for s in all_sessions if (s.get("last_active") or "").startswith(today_iso)
        )
    except Exception:
        file_completed_today = 0

    completed_today = db_completed_today + file_completed_today

    return {
        "running": running,
        "queued": queued,
        "pending_approval": pending_approval,
        "completed_today": completed_today,
    }


@router.get("/recent-tasks")
async def get_recent_tasks(
    workspace_id: str = "default", limit: int = Query(10, ge=1, le=50)
):
    """最近任务列表：合并 DB tasks 与本地 Agent 会话发现结果。

    DB tasks 仅记录 Web 工作台显式创建的任务；本地 Agent 会话（codex/claude/qoder）
    通过 session_discovery 实时发现，对用户来说同样是"最近完成的任务"。
    两者按时间倒序合并去重后返回前 ``limit`` 条。
    """
    async with async_session_factory() as session:
        r = await session.execute(
            text(
                "SELECT id, prompt, agent_id, model, status, created_at,"
                " started_at, completed_at, duration_ms, session_id"
                " FROM tasks WHERE workspace_id = :ws"
                " ORDER BY created_at DESC LIMIT :limit"
            ),
            {"ws": workspace_id, "limit": limit},
        )
        rows = r.fetchall()

    tasks: list[dict] = []
    seen_ids: set[str] = set()
    seen_session_ids: set[str] = set()
    for row in rows:
        tid = row[0]
        if tid in seen_ids:
            continue
        seen_ids.add(tid)
        # Track session_id to deduplicate against file sessions
        row_session_id = row[9]
        if row_session_id:
            seen_session_ids.add(row_session_id)
        tasks.append(
            {
                "id": tid,
                "prompt": row[1],
                "agent_id": row[2],
                "model": row[3],
                "status": row[4],
                "created_at": row[5],
                "started_at": row[6],
                "completed_at": row[7],
                "duration_ms": row[8],
            }
        )

    # 合并文件会话：将本地 Agent 会话纳入"最近任务"列表
    try:
        sessions = discover_sessions(limit=limit * 2)
    except Exception:
        sessions = []

    for s in sessions:
        sid = s.get("session_id") or s.get("id") or ""
        if not sid or sid in seen_ids or sid in seen_session_ids:
            continue
        seen_ids.add(sid)
        tasks.append(
            {
                "id": sid,
                "prompt": s.get("title") or sid,
                "agent_id": s.get("agent_id"),
                "model": None,
                "status": s.get("status", "completed"),
                "created_at": s.get("created_at"),
                "started_at": s.get("created_at"),
                "completed_at": s.get("last_active"),
                "duration_ms": None,
            }
        )

    # 按 created_at 降序排列（最新创建的在最前），取 top limit
    # 使用 created_at 作为主键以保证“最近任务”严格按创建时间倒序，
    # 避免文件会话 last_active(=completed_at) 抢占新建任务位置。
    def _sort_key(t: dict) -> str:
        return t.get("created_at") or t.get("completed_at") or ""

    tasks.sort(key=_sort_key, reverse=True)
    return {"tasks": tasks[:limit]}


# ---------- 工作台增强统计 ----------

# task_events.event_type 实际写入值来自 backend.services.event_emitter._record_event：
# - ``created`` / ``updated``
# - ``status_changed:<new_status>``（如 ``status_changed:running``）
# - ``review_requested`` / ``approval_approved`` / ``approval_rejected``
# - ``approval_request`` / ``output``
# 为保持向后兼容，同时保留部分点分隔风格事件名。
_TIMELINE_EVENT_TYPES: tuple[str, ...] = (
    "created",
    "updated",
    "review_requested",
    "approval_request",
    "approval_approved",
    "approval_rejected",
    # 点分隔风格兼容（部分预留名称，以防后续实现切换）
    "task.created",
    "task.status_changed",
    "task.updated",
    "approval.requested",
    "approval.resolved",
    "plan.task.completed",
    "workflow.node.completed",
)


@router.get("/active-projects")
async def get_active_projects(
    workspace_id: str = "default",
    limit: int = Query(5, ge=1, le=50),
):
    """最近活跃项目列表。

    本项目不存在独立的 ``projects`` 表，项目以 ``tasks.cwd`` 为唯一标识，
    详见 ``backend/api/projects.py``。这里按 ``cwd`` 聚合，输出与用户请求
    一致的字段集（id/name/description/task_count/last_active/running_count）。
    """
    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    """
                    SELECT cwd,
                           COUNT(*) AS task_count,
                           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
                           MAX(COALESCE(started_at, created_at)) AS last_active
                    FROM tasks
                    WHERE workspace_id = :ws
                      AND cwd IS NOT NULL AND cwd != ''
                    GROUP BY cwd
                    ORDER BY last_active DESC NULLS LAST
                    LIMIT :limit
                    """
                ),
                {"ws": workspace_id, "limit": limit},
            )
            rows = r.fetchall()
    except Exception as exc:  # 表不存在 / DB 未初始化 → 返回空列表
        logger.warning("active-projects query failed: %s", exc)
        return []

    registry = _load_registered_projects()
    projects: list[dict] = []
    for row in rows:
        cwd = row[0] or ""
        reg = registry.get(cwd) or {}
        projects.append(
            {
                "id": _encode_project_id(cwd),
                "name": reg.get("name") or _project_name_from_cwd(cwd),
                "description": reg.get("description") or cwd,
                "task_count": int(row[1] or 0),
                "last_active": row[3],
                "running_count": int(row[2] or 0),
            }
        )
    return projects


@router.get("/activity-timeline")
async def get_activity_timeline(
    workspace_id: str = "default",
    limit: int = Query(15, ge=1, le=100),
):
    """最近系统活动事件时间线（按 task_events.created_at DESC）。

    联合 tasks 表补充 task_title / project_name（project 名称取自 ``tasks.cwd``
    的路径末段，与 ``backend/api/projects.py`` 的项目命名策略保持一致）。
    若 ``task_events`` 表不存在或查询异常，返回空列表而非报错。
    """
    placeholders = ",".join(f":t{i}" for i in range(len(_TIMELINE_EVENT_TYPES)))
    params: dict = {"ws": workspace_id, "limit": limit}
    for i, et in enumerate(_TIMELINE_EVENT_TYPES):
        params[f"t{i}"] = et

    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    f"""
                    SELECT e.id, e.event_type, e.task_id, e.payload, e.created_at,
                           t.prompt AS task_title, t.cwd AS task_cwd
                    FROM task_events e
                    LEFT JOIN tasks t ON t.id = e.task_id
                    WHERE e.workspace_id = :ws
                      AND (
                        e.event_type IN ({placeholders})
                        OR e.event_type LIKE 'status_changed:%'
                      )
                    ORDER BY e.created_at DESC
                    LIMIT :limit
                    """
                ),
                params,
            )
            rows = r.fetchall()
    except Exception as exc:
        logger.warning("activity-timeline query failed: %s", exc)
        return []

    registry = _load_registered_projects()
    events: list[dict] = []
    for row in rows:
        payload_raw = row[3]
        if isinstance(payload_raw, str) and payload_raw:
            try:
                payload = json.loads(payload_raw)
            except (TypeError, ValueError):
                payload = {"raw": payload_raw}
        else:
            payload = payload_raw or {}

        cwd = row[6] or ""
        reg = registry.get(cwd) or {}
        project_name = reg.get("name") or (_project_name_from_cwd(cwd) if cwd else None)

        events.append(
            {
                "id": row[0],
                "event_type": row[1],
                "task_id": row[2],
                "task_title": row[5],
                "project_name": project_name,
                "payload": payload,
                "created_at": row[4],
            }
        )
    return events


@router.get("/task-status-distribution")
async def get_task_status_distribution(workspace_id: str = "default"):
    """任务状态分布。

    默认返回完整状态集（queued/running/completed/failed/cancelled/review）以便
    前端直接渲染图表；若出现未列举的状态亦同步返回。
    """
    distribution: dict[str, int] = {
        "queued": 0,
        "running": 0,
        "completed": 0,
        "failed": 0,
        "cancelled": 0,
        "review": 0,
    }
    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    "SELECT status, COUNT(*) FROM tasks"
                    " WHERE workspace_id = :ws GROUP BY status"
                ),
                {"ws": workspace_id},
            )
            rows = r.fetchall()
    except Exception as exc:
        logger.warning("task-status-distribution query failed: %s", exc)
        return distribution

    for status, count in rows:
        if not status:
            continue
        distribution[status] = int(count or 0)
    return distribution


@router.get("/upcoming-schedules")
async def get_upcoming_schedules(
    workspace_id: str = "default",
    limit: int = Query(5, ge=1, le=50),
):
    """即将执行的定时调度。

    优先从 APScheduler 读取实时 ``next_run_time``，并以此覆盖 DB 中
    ``next_run_at`` 字段；如 scheduler 未启动或 job 已被移除则回退到
    DB 记录。返回按 ``next_run_at ASC`` 排序、空值后置。
    """
    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    """
                    SELECT id, name, trigger_type, next_run_at, last_run_at,
                           enabled, run_count
                    FROM schedules
                    WHERE workspace_id = :ws AND enabled = 1
                    """
                ),
                {"ws": workspace_id},
            )
            rows = r.fetchall()
    except Exception as exc:
        logger.warning("upcoming-schedules query failed: %s", exc)
        return []

    # 从 APScheduler 获取实时 next_run_time
    next_run_map: dict[str, Optional[str]] = {}
    try:
        from backend.services.schedule_service import schedule_service

        scheduler = getattr(schedule_service, "scheduler", None)
        if scheduler is not None:
            for job in scheduler.get_jobs():
                nrt = getattr(job, "next_run_time", None)
                next_run_map[job.id] = nrt.isoformat() if nrt else None
    except Exception as exc:
        logger.debug("APScheduler get_jobs failed, falling back to DB: %s", exc)

    items: list[dict] = []
    for row in rows:
        sid = row[0]
        next_run_at = next_run_map.get(sid) or row[3]
        items.append(
            {
                "id": sid,
                "name": row[1],
                "schedule_type": row[2],
                "next_run_at": next_run_at,
                "last_run_at": row[4],
                "enabled": bool(row[5]),
                "run_count": int(row[6] or 0),
            }
        )

    # next_run_at ASC；空值排最后
    items.sort(key=lambda x: (x["next_run_at"] is None, x["next_run_at"] or ""))
    return items[:limit]
