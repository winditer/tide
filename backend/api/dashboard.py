import base64
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from backend.core.dependencies import (
    get_accessible_project_ids,
    get_optional_user,
)
from backend.db.engine import async_session_factory
from backend.services.session_discovery import discover_sessions

logger = logging.getLogger("tide.dashboard")

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ---------- 内部工具 ----------


def _encode_project_id(cwd: str) -> str:
    """与 backend/api/projects.py 保持一致的 base64 url-safe 编码。"""
    return base64.urlsafe_b64encode((cwd or "").encode()).decode().rstrip("=")


def _decode_project_id(pid: str) -> Optional[str]:
    """将 encode_project_id 反解为原始 cwd。失败返回 None。"""
    try:
        padded = pid + "=" * (-len(pid) % 4)
        return base64.urlsafe_b64decode(padded.encode()).decode()
    except Exception:
        return None


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


def _build_cwd_filter(
    accessible_pids: Optional[set[str]],
    column: str = "cwd",
    prefix: str = "acwd",
) -> tuple[str, dict, Optional[set[str]]]:
    """构造按 cwd 过滤的 SQL 片段。

    返回 ``(sql_fragment, params, allowed_cwds)``：
    - ``accessible_pids`` 为 ``None`` 时不限制（admin/匿名），返回空片段。
    - ``accessible_pids`` 为空集合时返回 ``" AND 1=0"`` 永假条件。
    - 否则返回 ``" AND <column> IN (...)"`` 片段及绑定参数。

    ``allowed_cwds`` 提供给 Python 侧（如文件会话过滤）使用，
    与 SQL 片段保持一致；为 ``None`` 表示不限制。
    """
    if accessible_pids is None:
        return "", {}, None
    if not accessible_pids:
        return " AND 1=0", {}, set()
    cwds: list[str] = []
    for pid in accessible_pids:
        cwd = _decode_project_id(pid)
        if cwd:
            cwds.append(cwd)
    if not cwds:
        return " AND 1=0", {}, set()
    placeholders = ",".join(f":{prefix}{i}" for i in range(len(cwds)))
    params = {f"{prefix}{i}": cwd for i, cwd in enumerate(cwds)}
    return f" AND {column} IN ({placeholders})", params, set(cwds)


def _build_work_item_pid_clause(
    accessible_pids: Optional[set[str]],
    prefix: str = "wpid",
) -> tuple[Optional[str], dict]:
    """构造工作项表的 ``project_id`` 过滤片段。

    返回 ``(sql_fragment, params)``：
    - ``accessible_pids`` 为 ``None`` 表示不限制（admin/匿名），返回空片段。
    - ``accessible_pids`` 为空集合表示“无可访问项目”，返回 ``None``
      表示上层应跳过查询。
    - 其余返回 " AND project_id IN (...)" 片段及其参数。
    """
    if accessible_pids is None:
        return "", {}
    if not accessible_pids:
        return None, {}
    placeholders = ",".join(f":{prefix}{i}" for i in range(len(accessible_pids)))
    params = {f"{prefix}{i}": pid for i, pid in enumerate(accessible_pids)}
    return f" AND project_id IN ({placeholders})", params


def _current_user_assignees(current_user: Optional[dict]) -> list[str]:
    """返回“当前用户作为 assignee 可能的字符串”集合。

    work_items 创建时 assignee 写入 ``display_name or username``（
    参见 ``WorkItemCreateDialog``），这里同时返回两者，SQL 中以
    ``IN`` 多值匹配，最大限度覆盖列表页“未指定务名字”的人工输入场景。
    """
    if not current_user:
        return []
    candidates: list[str] = []
    for key in ("display_name", "username"):
        v = current_user.get(key)
        if isinstance(v, str) and v and v not in candidates:
            candidates.append(v)
    return candidates


def _week_start_iso() -> str:
    """返回本周周一 00:00:00 的 ISO8601 字符串（UTC）。

    与 SQLite 的 TIMESTAMP 文本比较：ISO 格式下字符串比较与时间比较
    一致，作为 ``completed_at >= :week_start`` 的边界不会出现偏差。
    """
    now = datetime.now(timezone.utc)
    monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return monday.isoformat().replace("+00:00", "Z")


@router.get("/stats")
async def get_stats(
    workspace_id: str = "default",
    current_user=Depends(get_optional_user),
):
    """统计数据：运行中 / 排队中 / 待审批 / 今日完成。

    数据源说明：
    - running / queued: DB ``tasks`` 表（仅 Web 工作台显式创建的任务进入 DB）。
    - pending_approval: DB ``approvals`` 表。
    - completed_today: 来自本地 Agent 会话文件发现 (session_discovery)，
      统计今日 ``last_active`` 的会话数（每完结一次对话即视为一次完成），
      并叠加 DB 中今日 ``completed_at`` 的任务数，避免双重数据源遗漏。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    cwd_clause, cwd_params, allowed_cwds = _build_cwd_filter(accessible_pids)

    async with async_session_factory() as session:
        r = await session.execute(
            text(
                "SELECT COUNT(*) FROM tasks WHERE workspace_id = :ws"
                f" AND status = 'running'{cwd_clause}"
            ),
            {"ws": workspace_id, **cwd_params},
        )
        running = r.scalar() or 0

        r = await session.execute(
            text(
                "SELECT COUNT(*) FROM tasks WHERE workspace_id = :ws"
                f" AND status = 'queued'{cwd_clause}"
            ),
            {"ws": workspace_id, **cwd_params},
        )
        queued = r.scalar() or 0

        # 普通任务审批：通过 tasks 表反查（排除 work_item_transition 类型，
        # 因为该类型的 a.task_id 实际是 work_item_id，无法在 tasks 表中查到）。
        r = await session.execute(
            text(
                "SELECT COUNT(*) FROM approvals a"
                " WHERE a.workspace_id = :ws AND a.status = 'pending'"
                " AND a.type != 'work_item_transition'"
                " AND a.task_id IN ("
                "   SELECT id FROM tasks"
                "   WHERE status IN ('review', 'pending', 'running')"
                f"   {cwd_clause}"
                " )"
            ),
            {"ws": workspace_id, **cwd_params},
        )
        task_approval_count = r.scalar() or 0

        # 工作项审批：a.task_id 实际存的是 work_item_id，需通过 work_items 表反查。
        # work_items.project_id 已经是编码后的 project_id，可直接与
        # accessible_pids 比对。该类型审批创建时 workspace_id 固定为 "default"，
        # 这里不再按当前 workspace_id 过滤，避免漏计。
        wi_sql = (
            "SELECT COUNT(*) FROM approvals a"
            " WHERE a.status = 'pending'"
            " AND a.type = 'work_item_transition'"
            " AND a.task_id IN (SELECT id FROM work_items{wi_filter})"
        )
        wi_params: dict = {}
        if accessible_pids is None:
            wi_filter = ""
        elif not accessible_pids:
            wi_filter = " WHERE 1=0"
        else:
            placeholders = ",".join(
                f":wp{i}" for i in range(len(accessible_pids))
            )
            wi_filter = f" WHERE project_id IN ({placeholders})"
            for i, pid in enumerate(accessible_pids):
                wi_params[f"wp{i}"] = pid
        r = await session.execute(
            text(wi_sql.format(wi_filter=wi_filter)),
            wi_params,
        )
        work_item_approval_count = r.scalar() or 0

        pending_approval = task_approval_count + work_item_approval_count

        r = await session.execute(
            text(
                "SELECT COUNT(*) FROM tasks WHERE workspace_id = :ws"
                " AND status = 'completed' AND DATE(completed_at) = DATE('now')"
                f"{cwd_clause}"
            ),
            {"ws": workspace_id, **cwd_params},
        )
        db_completed_today = r.scalar() or 0

        # 获取今日已完成 DB 任务的 session_id 集合，用于去重
        r = await session.execute(
            text(
                "SELECT session_id FROM tasks WHERE workspace_id = :ws"
                " AND status = 'completed' AND DATE(completed_at) = DATE('now')"
                " AND session_id IS NOT NULL AND session_id != ''"
                f"{cwd_clause}"
            ),
            {"ws": workspace_id, **cwd_params},
        )
        db_session_ids = {row[0] for row in r.fetchall()}

    # 今日完成 = DB 完成任务 + 今日 last_active 的本地 Agent 会话（去重）
    today_iso = date.today().isoformat()
    try:
        all_sessions = discover_sessions()
        file_completed_today = 0
        for s in all_sessions:
            # 仅统计 last_active 为今天的会话
            if not (s.get("last_active") or "").startswith(today_iso):
                continue
            # 与 tasks.py 一致：仅计入 session_source=="exec" 的文件会话
            if s.get("session_source") != "exec":
                continue
            # 去重：已在 DB 中有对应 completed 记录的不重复计数
            sid = s.get("session_id") or s.get("id") or ""
            if sid and sid in db_session_ids:
                continue
            if allowed_cwds is not None and (s.get("cwd") or "") not in allowed_cwds:
                continue
            file_completed_today += 1
    except Exception:
        file_completed_today = 0

    completed_today = db_completed_today + file_completed_today

    # ── 工作项统计（我的待办 / 本周完成）─────────────────────
    # assignee 在 work_items 中以“display_name 或 username”入库（参见
    # WorkItemCreateDialog），这里同时匹配两者以提高统计准确性。
    # 当未登录或无可访问项目时，返回 0，不报错。
    my_work_items_count = 0
    weekly_completed_work_items = 0
    wi_assignees = _current_user_assignees(current_user)
    wi_pid_clause, wi_pid_params = _build_work_item_pid_clause(accessible_pids)
    if wi_assignees and wi_pid_clause is not None:
        a_placeholders = ",".join(f":a{i}" for i in range(len(wi_assignees)))
        a_params = {f"a{i}": v for i, v in enumerate(wi_assignees)}
        try:
            async with async_session_factory() as session:
                r = await session.execute(
                    text(
                        "SELECT COUNT(*) FROM work_items"
                        f" WHERE assignee IN ({a_placeholders})"
                        " AND completed_at IS NULL"
                        f"{wi_pid_clause}"
                    ),
                    {**a_params, **wi_pid_params},
                )
                my_work_items_count = int(r.scalar() or 0)

                week_start = _week_start_iso()
                r = await session.execute(
                    text(
                        "SELECT COUNT(*) FROM work_items"
                        f" WHERE assignee IN ({a_placeholders})"
                        " AND completed_at IS NOT NULL"
                        " AND completed_at >= :week_start"
                        f"{wi_pid_clause}"
                    ),
                    {**a_params, "week_start": week_start, **wi_pid_params},
                )
                weekly_completed_work_items = int(r.scalar() or 0)
        except Exception as exc:  # 表不存在 / 迁移未完成 → 返回 0。
            logger.warning("work-item stats query failed: %s", exc)

    return {
        "running": running,
        "queued": queued,
        "pending_approval": pending_approval,
        "completed_today": completed_today,
        "my_work_items_count": my_work_items_count,
        "weekly_completed_work_items": weekly_completed_work_items,
    }


@router.get("/recent-tasks")
async def get_recent_tasks(
    workspace_id: str = "default",
    limit: int = Query(10, ge=1, le=50),
    current_user=Depends(get_optional_user),
):
    """最近任务列表：合并 DB tasks 与本地 Agent 会话发现结果。

    DB tasks 仅记录 Web 工作台显式创建的任务；本地 Agent 会话（codex/claude/qoder）
    通过 session_discovery 实时发现，对用户来说同样是“最近完成的任务”。
    两者按时间倒序合并去重后返回前 ``limit`` 条。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    cwd_clause, cwd_params, allowed_cwds = _build_cwd_filter(accessible_pids)

    async with async_session_factory() as session:
        r = await session.execute(
            text(
                "SELECT id, prompt, agent_id, model, status, created_at,"
                " started_at, completed_at, duration_ms, session_id"
                " FROM tasks WHERE workspace_id = :ws"
                f"{cwd_clause}"
                " ORDER BY created_at DESC LIMIT :limit"
            ),
            {"ws": workspace_id, "limit": limit, **cwd_params},
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

    # 合并文件会话：将本地 Agent 会话纳入“最近任务”列表
    try:
        sessions = discover_sessions(limit=limit * 2)
    except Exception:
        sessions = []

    for s in sessions:
        sid = s.get("session_id") or s.get("id") or ""
        if not sid or sid in seen_ids or sid in seen_session_ids:
            continue
        if allowed_cwds is not None and (s.get("cwd") or "") not in allowed_cwds:
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
    current_user=Depends(get_optional_user),
):
    """最近活跃项目列表。

    本项目不存在独立的 ``projects`` 表，项目以 ``tasks.cwd`` 为唯一标识，
    详见 ``backend/api/projects.py``。这里按 ``cwd`` 聚合，输出与用户请求
    一致的字段集（id/name/description/task_count/last_active/running_count）。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    cwd_clause, cwd_params, _ = _build_cwd_filter(accessible_pids)

    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    f"""
                    SELECT cwd,
                           COUNT(*) AS task_count,
                           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
                           MAX(COALESCE(started_at, created_at)) AS last_active
                    FROM tasks
                    WHERE workspace_id = :ws
                      AND cwd IS NOT NULL AND cwd != ''
                      {cwd_clause}
                    GROUP BY cwd
                    ORDER BY last_active DESC NULLS LAST
                    LIMIT :limit
                    """
                ),
                {"ws": workspace_id, "limit": limit, **cwd_params},
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
    current_user=Depends(get_optional_user),
):
    """最近系统活动事件时间线（按 task_events.created_at DESC）。

    联合 tasks 表补充 task_title / project_name（project 名称取自 ``tasks.cwd``
    的路径末段，与 ``backend/api/projects.py`` 的项目命名策略保持一致）。
    若 ``task_events`` 表不存在或查询异常，返回空列表而非报错。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    cwd_clause, cwd_params, _ = _build_cwd_filter(
        accessible_pids, column="t.cwd"
    )

    placeholders = ",".join(f":t{i}" for i in range(len(_TIMELINE_EVENT_TYPES)))
    params: dict = {"ws": workspace_id, "limit": limit, **cwd_params}
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
                      {cwd_clause}
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
async def get_task_status_distribution(
    workspace_id: str = "default",
    current_user=Depends(get_optional_user),
):
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
    accessible_pids = await get_accessible_project_ids(current_user)
    cwd_clause, cwd_params, _ = _build_cwd_filter(accessible_pids)

    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    "SELECT status, COUNT(*) FROM tasks"
                    f" WHERE workspace_id = :ws{cwd_clause} GROUP BY status"
                ),
                {"ws": workspace_id, **cwd_params},
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
    current_user=Depends(get_optional_user),
):
    """即将执行的定时调度。

    优先从 APScheduler 读取实时 ``next_run_time``，并以此覆盖 DB 中
    ``next_run_at`` 字段；如 scheduler 未启动或 job 已被移除则回退到
    DB 记录。返回按 ``next_run_at ASC`` 排序、空值后置。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    # schedules 的 cwd 存在 task_config (JSON) 中，无法在 SQL 直接过滤。
    # 这里读出后在 Python 侧按 task_config.cwd 过滤，与
    # backend/api/schedules.py::list_schedules 保持一致策略。
    if accessible_pids is not None and not accessible_pids:
        return []

    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    """
                    SELECT id, name, trigger_type, next_run_at, last_run_at,
                           enabled, run_count, task_config
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
        # 项目级权限过滤：解析 task_config.cwd 后比对 accessible_pids
        if accessible_pids is not None:
            raw_cfg = row[7]
            cfg: dict = {}
            if isinstance(raw_cfg, str) and raw_cfg:
                try:
                    cfg = json.loads(raw_cfg) or {}
                except (TypeError, ValueError):
                    cfg = {}
            elif isinstance(raw_cfg, dict):
                cfg = raw_cfg
            cwd = cfg.get("cwd") if isinstance(cfg, dict) else ""
            if cwd and _encode_project_id(cwd) not in accessible_pids:
                continue

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


# ---------- 工作项相关：我的工作项 / 项目进度 ----------


@router.get("/work-items")
async def get_my_work_items(
    limit: int = Query(10, ge=1, le=50),
    current_user=Depends(get_optional_user),
):
    """获取当前用户的待办工作项（默认前 10 条）。

    数据源：``work_items`` 表，过滤条件：
    - ``assignee`` 命中当前用户的 display_name 或 username；
    - ``completed_at IS NULL``（即未完成）；
    - ``project_id`` 在用户可访问项目集合内（admin / 关闭鉴权时不限制）。

    排序：``priority DESC, created_at DESC``。
    每条返回项额外附带：
    - ``project_name``：通过 cwd 解码 + ``registered_projects.json`` 解析；
    - ``status``：通过 workflow definition + 节点类型推导（与列表页一致）。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    assignees = _current_user_assignees(current_user)
    if not assignees:
        return []
    pid_clause, pid_params = _build_work_item_pid_clause(accessible_pids)
    if pid_clause is None:
        return []

    a_placeholders = ",".join(f":a{i}" for i in range(len(assignees)))
    a_params = {f"a{i}": v for i, v in enumerate(assignees)}

    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    "SELECT id, project_id, workflow_id, current_node_id,"
                    " title, description, priority, assignee, version_id,"
                    " started_at, completed_at, created_at, updated_at"
                    " FROM work_items"
                    f" WHERE assignee IN ({a_placeholders})"
                    " AND completed_at IS NULL"
                    f"{pid_clause}"
                    " ORDER BY priority DESC, created_at DESC"
                    " LIMIT :limit"
                ),
                {**a_params, **pid_params, "limit": limit},
            )
            rows = r.fetchall()
    except Exception as exc:
        logger.warning("get_my_work_items query failed: %s", exc)
        return []

    if not rows:
        return []

    # 通过 work_item_service 推导 status，复用与工作项列表页一致的逻辑。
    from backend.services.work_item_service import work_item_service

    items: list[dict] = [
        {
            "id": row[0],
            "project_id": row[1],
            "workflow_id": row[2],
            "current_node_id": row[3],
            "title": row[4],
            "description": row[5],
            "priority": int(row[6] or 0),
            "assignee": row[7],
            "version_id": row[8],
            "started_at": row[9],
            "completed_at": row[10],
            "created_at": row[11],
            "updated_at": row[12],
        }
        for row in rows
    ]
    try:
        await work_item_service._enrich_status(items)
    except Exception as exc:  # 推导失败不影响列表展示
        logger.warning("enrich work-item status failed: %s", exc)

    # 解析 project_name
    registry = _load_registered_projects()
    for item in items:
        cwd = _decode_project_id(item["project_id"]) or ""
        reg = registry.get(cwd) or {}
        item["project_name"] = (
            reg.get("name") or _project_name_from_cwd(cwd) if cwd else None
        )
    return items


@router.get("/project-progress")
async def get_project_progress(
    limit: int = Query(8, ge=1, le=50),
    current_user=Depends(get_optional_user),
):
    """获取各项目工作项进度（仅返回总数 > 0 的项目）。

    返回字段：``id / name / total / completed``，按 ``total DESC`` 排序。
    项目名称通过 cwd 反解 + 注册表解析；找不到则使用 cwd 路径末段。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    pid_clause, pid_params = _build_work_item_pid_clause(accessible_pids)
    if pid_clause is None:
        return []

    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    "SELECT project_id, COUNT(*) AS total,"
                    " SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END)"
                    " AS completed"
                    " FROM work_items"
                    " WHERE 1=1"
                    f"{pid_clause}"
                    " GROUP BY project_id"
                    " HAVING total > 0"
                    " ORDER BY total DESC"
                    " LIMIT :limit"
                ),
                {**pid_params, "limit": limit},
            )
            rows = r.fetchall()
    except Exception as exc:
        logger.warning("project-progress query failed: %s", exc)
        return []

    registry = _load_registered_projects()
    results: list[dict] = []
    for row in rows:
        pid = row[0]
        cwd = _decode_project_id(pid) or ""
        reg = registry.get(cwd) or {}
        results.append(
            {
                "id": pid,
                "name": reg.get("name") or _project_name_from_cwd(cwd) or pid,
                "total": int(row[1] or 0),
                "completed": int(row[2] or 0),
            }
        )
    return results
