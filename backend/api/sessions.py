"""会话 API：合并 SQLite tasks 表（按 session_id 聚合）+ 本地 Agent 会话文件扫描。

提供：
- GET  /api/sessions               会话列表（对齐 Lark /chats）
- GET  /api/sessions/{session_id}  会话详情（含对话消息流 + 关联任务）
- POST /api/sessions               新建会话（创建占位任务，Agent 启动后回写 session_id）
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.archive_service import archive_store, resolve_show_archived
from backend.services.session_discovery import (
    discover_chats,
    discover_sessions,
    find_session,
    read_session_messages,
)
from backend.services.task_service import task_service

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _sort_key(item: dict) -> str:
    return str(item.get("last_active") or "")


# ── Schemas ───────────────────────────────────────────


class SessionCreate(BaseModel):
    # 传 cwd → 项目会话（convo）；不传或空 → 普通对话（chat）
    project_cwd: Optional[str] = Field(
        default="", description="项目工作目录；留空则创建普通对话（chat）"
    )
    agent_id: str = Field("codex", description="Agent 标识")
    title: Optional[str] = Field(None, description="可选会话标题，作为初始 prompt")
    model: Optional[str] = None
    workspace_id: str = "default"
    session_type: Optional[str] = Field(
        default=None,
        description="会话类型：'convo'/'chat'，可选，默认根据是否提供 cwd 推断",
    )


# ── List ──────────────────────────────────────────────


@router.get("/list-for-project")
async def list_sessions_for_project(
    cwd: str = Query(..., description="项目工作目录"),
):
    """精简会话列表，供前端下拉框使用。

    返回指定项目下的 project 会话 + 全局 chat 会话，按 created_at 降序排列。
    """
    items: list[dict] = []

    # 1) 项目会话
    for s in discover_sessions(project_cwd=cwd):
        items.append({
            "id": s.get("session_id") or s.get("id") or "",
            "title": s.get("title") or "",
            "agent_id": s.get("agent_id") or "codex",
            "created_at": s.get("created_at") or s.get("last_active") or "",
            "type": "project",
        })

    # 2) 普通对话
    for c in discover_chats():
        items.append({
            "id": c.get("session_id") or c.get("id") or "",
            "title": c.get("title") or "",
            "agent_id": c.get("agent_id") or "codex",
            "created_at": c.get("created_at") or c.get("last_active") or "",
            "type": "chat",
        })

    # 3) 按 created_at 降序
    items.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)

    return {"sessions": items}


@router.get("/chats")
async def list_chats(
    agent_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    show_archived: Optional[bool] = Query(
        None, description="是否包含已归档会话；缺省读取 LARK2AGENT_SHOW_ARCHIVED"
    ),
):
    """普通对话列表（不绑定项目），等价于 type=chat 的快捷入口。"""
    offset = (page - 1) * page_size
    chats = discover_chats(agent_id=agent_id, limit=page_size, offset=offset, force=False)
    # 获取总数（不分页）
    total_items = discover_chats(agent_id=agent_id, force=False)

    include_archived = resolve_show_archived(show_archived)
    archived_ids = set(archive_store.list_archived_sessions())

    def _decorate(items: list[dict]) -> list[dict]:
        out: list[dict] = []
        for it in items:
            sid = it.get("session_id") or it.get("id") or ""
            is_archived = sid in archived_ids
            if is_archived and not include_archived:
                continue
            row = dict(it)
            row["archived"] = is_archived
            out.append(row)
        return out

    decorated = _decorate(chats)
    total = len(_decorate(total_items))

    return {
        "sessions": decorated,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("")
async def list_sessions(
    workspace_id: str = Query("default"),
    project: Optional[str] = Query(None, description="按项目根/cwd 过滤"),
    agent_id: Optional[str] = Query(None),
    type: Optional[str] = Query("all", description="会话类型过滤: all/project/chat"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    show_archived: Optional[bool] = Query(
        None, description="是否包含已归档会话；缺省读取 LARK2AGENT_SHOW_ARCHIVED"
    ),
):
    """会话列表：DB 优先（按 session_id 聚合），文件扫描补充。支持 type 过滤。"""
    db_sessions: list[dict] = []
    async with async_session_factory() as session:
        conditions = [
            "workspace_id = :ws",
            "session_id IS NOT NULL",
            "session_id != ''",
            # 排除 Plan 子任务，避免它们出现在 Chat/Session 列表
            "id NOT IN (SELECT task_id FROM plan_tasks)",
        ]
        params: dict = {"ws": workspace_id}
        if agent_id:
            conditions.append("agent_id = :agent_id")
            params["agent_id"] = agent_id
        if project:
            conditions.append("(cwd = :project OR cwd LIKE :project_prefix)")
            params["project"] = project
            params["project_prefix"] = project.rstrip("/") + "/%"
        where = " AND ".join(conditions)
        r = await session.execute(
            text(
                f"""
                SELECT session_id,
                       MAX(agent_id) as agent_id,
                       MAX(cwd) as cwd,
                       COUNT(*) as task_count,
                       MAX(status) as last_status,
                       MAX(created_at) as last_active
                FROM tasks
                WHERE {where}
                GROUP BY session_id
                ORDER BY last_active DESC
                """
            ),
            params,
        )
        for row in r.fetchall():
            db_sessions.append(
                {
                    "session_id": row[0],
                    "agent_id": row[1],
                    "cwd": row[2],
                    "task_count": row[3],
                    "last_status": row[4],
                    "last_active": row[5],
                    "source": "db",
                }
            )

    # 文件扫描补充
    db_sids = {s["session_id"] for s in db_sessions if s.get("session_id")}
    file_sessions: list[dict] = []
    for s in discover_sessions(project_cwd=project, agent_id=agent_id):
        sid = s.get("session_id")
        if sid and sid in db_sids:
            continue
        file_sessions.append(
            {
                "session_id": sid,
                "agent_id": s.get("agent_id"),
                "cwd": s.get("cwd"),
                "project_root": s.get("project_root"),
                "project_name": s.get("project_name"),
                "task_count": 1,
                "last_status": s.get("status") or "completed",
                "last_active": s.get("last_active"),
                "title": s.get("title"),
                "source": "file",
            }
        )

    merged = db_sessions + file_sessions
    if agent_id:
        merged = [it for it in merged if it.get("agent_id") == agent_id]

    # type 过滤
    if type == "project":
        merged = [it for it in merged if it.get("project_root")]
    elif type == "chat":
        merged = [it for it in merged if not it.get("project_root")]
    # type == "all" 或其它值不过滤

    merged.sort(key=_sort_key, reverse=True)

    # 归档过滤与标记
    include_archived = resolve_show_archived(show_archived)
    archived_ids = set(archive_store.list_archived_sessions())
    decorated: list[dict] = []
    for it in merged:
        sid = it.get("session_id") or ""
        is_archived = sid in archived_ids
        if is_archived and not include_archived:
            continue
        row = dict(it)
        row["archived"] = is_archived
        decorated.append(row)

    total = len(decorated)
    offset = (page - 1) * page_size
    paged = decorated[offset : offset + page_size]

    return {
        "sessions": paged,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ── Detail ────────────────────────────────────────────


async def _related_tasks(session_id: str, workspace_id: str = "default") -> list[dict]:
    async with async_session_factory() as session:
        r = await session.execute(
            text(
                """
                SELECT id, prompt, agent_id, status, cwd,
                       created_at, started_at, completed_at, duration_ms
                FROM tasks
                WHERE workspace_id = :ws AND session_id = :sid
                ORDER BY created_at DESC
                LIMIT 200
                """
            ),
            {"ws": workspace_id, "sid": session_id},
        )
        rows = r.fetchall()
    items: list[dict] = []
    for row in rows:
        d = dict(row._mapping)
        items.append(d)
    return items


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    workspace_id: str = Query("default"),
):
    """会话详情：返回会话元信息、对话消息流、关联任务。"""
    info = find_session(session_id)
    if info is None:
        # DB 中可能存在 session（聚合任务），文件未扫描到。降级返回任务聚合视图。
        related = await _related_tasks(session_id, workspace_id)
        if not related:
            raise HTTPException(status_code=404, detail="Session not found")
        agg = related[0]
        info = {
            "session_id": session_id,
            "id": session_id,
            "agent_id": agg.get("agent_id"),
            "cwd": agg.get("cwd"),
            "project_root": None,
            "project_name": None,
            "title": agg.get("prompt"),
            "status": agg.get("status"),
            "last_active": str(agg.get("created_at") or ""),
            "created_at": str(agg.get("created_at") or ""),
            "file": None,
            "source": "db",
        }
        messages: list[dict] = []
    else:
        file_path = info.get("file")
        agent_id = info.get("agent_id") or "codex"
        messages = (
            read_session_messages(file_path, agent_id) if file_path else []
        )
        related = await _related_tasks(session_id, workspace_id)

    return {
        "session": info,
        "messages": messages,
        "tasks": related,
    }


# ── Create ────────────────────────────────────────────


@router.post("")
async def create_session(body: SessionCreate):
    """新建会话。

    通过创建一个占位任务来表达"开启会话"，Agent 真正启动后会回写 ``session_id``
    并写入 ``~/.<agent>/...`` 目录的 JSONL 文件。
    返回 ``session_id``（与 task.id 同步，便于前端立即跳转）。
    """
    cwd = (body.project_cwd or "").strip()
    declared_type = (body.session_type or "").lower().strip()
    if declared_type == "chat":
        cwd = ""
    session_type = "convo" if cwd else "chat"

    default_prompt = "新会话" if session_type == "convo" else "新对话"
    prompt = (body.title or default_prompt).strip() or default_prompt

    # 预先生成 session_id，确保 tasks 表 session_id 列非空，
    # 否则后续 get_session/list_sessions 按 session_id 查询会 404。
    session_id = str(uuid.uuid4())

    task = await task_service.create_task(
        workspace_id=body.workspace_id,
        prompt=prompt,
        agent_id=body.agent_id,
        model=body.model or "",
        cwd=cwd,
        attachments=[],
        session_id=session_id,
    )
    if not task:
        raise HTTPException(status_code=500, detail="Failed to create session")

    return {
        "session_id": session_id,
        "task_id": task.get("id"),
        "agent_id": body.agent_id,
        "cwd": cwd,
        "title": prompt,
        "status": task.get("status") or "queued",
        "session_type": session_type,
    }


# ── Archive ───────────────────────────────────────────


@router.post("/{session_id}/archive")
async def archive_session(session_id: str):
    """归档会话（软操作，不删除任何文件/数据）。"""
    changed = archive_store.archive_session(session_id)
    return {"archived": True, "changed": changed, "id": session_id}


@router.post("/{session_id}/unarchive")
async def unarchive_session(session_id: str):
    """取消会话归档。"""
    changed = archive_store.unarchive_session(session_id)
    return {"archived": False, "changed": changed, "id": session_id}
