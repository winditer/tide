from datetime import date

from fastapi import APIRouter, Query
from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.session_discovery import discover_sessions

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


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
                " started_at, completed_at, duration_ms"
                " FROM tasks WHERE workspace_id = :ws"
                " ORDER BY created_at DESC LIMIT :limit"
            ),
            {"ws": workspace_id, "limit": limit},
        )
        rows = r.fetchall()

    tasks: list[dict] = []
    seen_ids: set[str] = set()
    for row in rows:
        tid = row[0]
        if tid in seen_ids:
            continue
        seen_ids.add(tid)
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
        if not sid or sid in seen_ids:
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
