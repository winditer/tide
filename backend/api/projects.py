"""项目 API 路由。

项目 ID 编码：
    project_id = base64.urlsafe_b64encode(cwd.encode()).decode().rstrip("=")
URL-safe 的 Base64 编码确保路径中的 ``/`` 不会破坏路由匹配；解码时容错回退到把
``project_id`` 当作裸 cwd 处理，保持向后兼容。

数据来源（按优先级合并）：
    1. ``project_discovery.discover_projects()`` — 扫描本地 Agent 会话文件
    2. ``tasks`` 表按 cwd 聚合的运行态/统计数据
    3. 已注册项目（``registered_projects.json``）— 即使尚无会话/任务也保留
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services import project_discovery
from backend.services.archive_service import archive_store, resolve_show_archived
from backend.services.session_discovery import (
    _session_references_project,
    discover_chats,
    discover_sessions,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ---------- 已注册项目（用户主动新建/添加的目录） ----------

REGISTRY_PATH = Path(
    os.getenv(
        "LARK2AGENT_PROJECTS_FILE",
        str(Path.home() / ".lark2agent" / "registered_projects.json"),
    )
).expanduser()
_REGISTRY_LOCK = threading.Lock()


class ProjectCreate(BaseModel):
    cwd: str
    name: Optional[str] = None
    tags: Optional[list[str]] = None


def _load_registry() -> list[dict]:
    if not REGISTRY_PATH.exists():
        return []
    try:
        data = json.loads(REGISTRY_PATH.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [item for item in (data or []) if isinstance(item, dict) and item.get("cwd")]


def _save_registry(items: list[dict]) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _registry_index() -> dict[str, dict]:
    return {item["cwd"]: item for item in _load_registry()}


# ---------- ID 编解码 ----------


def _encode_id(cwd: str) -> str:
    return base64.urlsafe_b64encode(cwd.encode()).decode().rstrip("=")


def _decode_id(project_id: str) -> str:
    """解码 project_id；失败时回退到原值（向后兼容旧裸路径 ID）。"""
    s = project_id or ""
    pad = "=" * (-len(s) % 4)
    try:
        decoded = base64.urlsafe_b64decode((s + pad).encode()).decode()
        if decoded:
            return decoded
    except (binascii.Error, UnicodeDecodeError, ValueError):
        pass
    return project_id


# ---------- 工具 ----------


def _max_iso(a, b):
    if not a:
        return b
    if not b:
        return a
    return a if a >= b else b


def _normalize_cwd(cwd: str) -> str:
    return str(Path(cwd).expanduser().resolve()) if cwd else cwd


async def _aggregate_db_stats(workspace_id: str) -> dict[str, dict]:
    """按 cwd 聚合 tasks 表统计。

    返回字段：
    - task_count: DB 中该 cwd 下的任务总数
    - running_tasks: 运行中任务数
    - last_active: 最近创建时间
    - session_ids: 该 cwd 下任务关联的 session_id 集合（用于与文件会话去重）
    """
    async with async_session_factory() as session:
        r = await session.execute(
            text(
                """
                SELECT cwd, COUNT(*) as task_count,
                       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
                       MAX(created_at) as last_active
                FROM tasks WHERE workspace_id = :ws AND cwd IS NOT NULL AND cwd != ''
                GROUP BY cwd
                """
            ),
            {"ws": workspace_id},
        )
        rows = r.fetchall()
        sid_r = await session.execute(
            text(
                """
                SELECT cwd, session_id FROM tasks
                WHERE workspace_id = :ws AND cwd IS NOT NULL AND cwd != ''
                  AND session_id IS NOT NULL AND session_id != ''
                """
            ),
            {"ws": workspace_id},
        )
        sid_rows = sid_r.fetchall()

    sid_map: dict[str, set[str]] = {}
    for cwd, sid in sid_rows:
        if cwd:
            sid_map.setdefault(cwd, set()).add(sid)

    return {
        row[0]: {
            "task_count": int(row[1] or 0),
            "running_tasks": int(row[2] or 0),
            "last_active": row[3],
            "session_ids": sid_map.get(row[0], set()),
        }
        for row in rows
        if row[0]
    }


def _project_payload(
    cwd: str,
    discovered: Optional[dict],
    db_stat: Optional[dict],
    registered: Optional[dict],
    session_count: Optional[int] = None,
    chat_count: Optional[int] = None,
    sessions: Optional[list[dict]] = None,
    archived: Optional[bool] = None,
) -> dict:
    name = (
        (registered or {}).get("name")
        or (discovered or {}).get("name")
        or (cwd.rstrip("/").split("/")[-1] or "Unknown")
    )
    db_count = int((db_stat or {}).get("task_count") or 0)
    running = int((db_stat or {}).get("running_tasks") or 0)
    db_session_ids: set[str] = set((db_stat or {}).get("session_ids") or set())
    last_active = _max_iso(
        (discovered or {}).get("last_active"),
        (db_stat or {}).get("last_active"),
    )
    agents = list((discovered or {}).get("agents") or [])
    status = "active" if running > 0 else "idle"

    # session_count: 由调用方通过 discover_sessions 获取真实数量
    # 如果未提供，回退到 discovered 中的文件扫描计数
    if sessions is not None:
        session_count = len(sessions)
    elif session_count is None:
        session_count = int((discovered or {}).get("task_count") or 0)

    # task_count: 只统计真正的“任务”——
    # DB 任务 + 文件会话中 session_source=="exec" 的（通过 Lark 面板下发的指令）。
    # 不包含 cli/vscode 的交互式会话。
    if sessions is not None:
        file_only = 0
        for s in sessions:
            # 只有 session_source == "exec" 的文件会话才算任务
            if s.get("session_source") != "exec":
                continue
            sid = s.get("session_id") or s.get("id")
            if not sid or sid not in db_session_ids:
                file_only += 1
        task_count = db_count + file_only
    else:
        # 回退：无 sessions 列表时只返回 db_count
        task_count = db_count

    project_id = _encode_id(cwd)
    if archived is None:
        archived = archive_store.is_project_archived(project_id)

    return {
        "id": project_id,
        "name": name,
        "cwd": cwd,
        "task_count": task_count,
        "running_tasks": running,
        "last_active": last_active,
        "status": status,
        "agents": agents,
        "session_count": session_count,
        # ``chat_count`` 仅在项目详情接口中精确计算（按会话内容引用匹配）；
        # 列表接口为避免对每个项目扫描所有 chat 文件内容（性能问题），
        # 调用方传 ``None`` 时这里直接返回 ``None``，前端展示 "—"。
        "chat_count": None if chat_count is None else int(chat_count),
        "registered": bool(registered),
        "tags": (registered or {}).get("tags") or [],
        "archived": bool(archived),
    }


# ---------- 路由 ----------


@router.get("")
async def list_projects(
    workspace_id: str = "default",
    show_archived: Optional[bool] = Query(
        None, description="是否包含已归档项目；缺省读取 LARK2AGENT_SHOW_ARCHIVED"
    ),
):
    """项目列表 — 文件发现 + DB 聚合 + 已注册项目合并。

    ``chat_count`` 性能折中策略：列表接口不返回项目维度的 chat_count（设为 ``None``）。
    精确的 chat_count 仅在项目详情接口 ``GET /api/projects/{id}`` 中按内容引用匹配计算
    （见 ``get_project`` / ``_project_chats``）；前端列表卡片在 chat_count 为空时显示 "—"。

    归档过滤：``show_archived`` 缺省读取 ``LARK2AGENT_SHOW_ARCHIVED`` 环境变量；
    为 false 默认隐藏已归档项目，为 true 时返回全部并在 payload 中标记 ``archived``。
    """
    discovered_list = project_discovery.discover_projects()
    discovered_map = {item["cwd"]: item for item in discovered_list}
    db_map = await _aggregate_db_stats(workspace_id)
    registry = _registry_index()

    cwds: set[str] = set()
    cwds.update(discovered_map.keys())
    cwds.update(db_map.keys())
    cwds.update(registry.keys())

    # 排除 .lark-codex/worktrees/ 下的临时工作树路径，
    # 防止 Plan 执行产生的 worktree 被误列为独立项目。
    cwds = {c for c in cwds if not project_discovery.is_worktree_path(c)}

    # 为每个项目预先获取会话列表（与 /api/tasks 合并逻辑保持一致：
    # task_count = DB 任务 + 文件会话按 session_id 去重）
    sessions_by_cwd: dict[str, list[dict]] = {}
    for cwd in cwds:
        sessions_by_cwd[cwd] = discover_sessions(project_cwd=cwd)

    # 列表接口不计算项目维度的 chat_count：
    # 全局 Chats 总数对所有项目都相同，且对每个项目精确匹配需要扫描所有 chat 文件内容，
    # 在项目数 × chat 数级别会触发明显的性能开销。统一传 ``None``，由详情接口精确计算。

    include_archived = resolve_show_archived(show_archived)
    archived_ids = set(archive_store.list_archived_projects())

    projects: list[dict] = []
    for cwd in cwds:
        pid = _encode_id(cwd)
        is_archived = pid in archived_ids
        if is_archived and not include_archived:
            continue
        projects.append(
            _project_payload(
                cwd=cwd,
                discovered=discovered_map.get(cwd),
                db_stat=db_map.get(cwd),
                registered=registry.get(cwd),
                sessions=sessions_by_cwd.get(cwd, []),
                chat_count=None,
                archived=is_archived,
            )
        )
    projects.sort(key=lambda p: (p.get("last_active") or ""), reverse=True)
    return {"projects": projects}


@router.post("")
async def create_project(body: ProjectCreate):
    """注册项目（告诉系统关注某个目录，不会执行 git init）。"""
    raw_cwd = (body.cwd or "").strip()
    if not raw_cwd:
        raise HTTPException(status_code=400, detail="cwd is required")
    path = Path(raw_cwd).expanduser()
    if not path.exists() or not path.is_dir():
        raise HTTPException(
            status_code=400, detail=f"Path does not exist or is not a directory: {raw_cwd}"
        )
    cwd = str(path.resolve())
    name = (body.name or path.name or cwd).strip()

    with _REGISTRY_LOCK:
        items = _load_registry()
        existing = next((it for it in items if it.get("cwd") == cwd), None)
        if existing:
            existing["name"] = name or existing.get("name") or path.name
            if body.tags is not None:
                existing["tags"] = list(body.tags)
        else:
            items.append(
                {
                    "cwd": cwd,
                    "name": name,
                    "tags": list(body.tags or []),
                    "added_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                }
            )
        _save_registry(items)

    project_discovery.clear_cache()

    discovered_list = project_discovery.discover_projects()
    discovered = next((p for p in discovered_list if p.get("cwd") == cwd), None)
    db_map = await _aggregate_db_stats("default")
    registry = _registry_index()
    return _project_payload(cwd, discovered, db_map.get(cwd), registry.get(cwd))


@router.get("/{project_id}")
async def get_project(project_id: str, workspace_id: str = "default"):
    """项目详情。"""
    cwd = _decode_id(project_id)
    discovered_list = project_discovery.discover_projects()
    discovered = next((p for p in discovered_list if p.get("cwd") == cwd), None)
    db_map = await _aggregate_db_stats(workspace_id)
    registry = _registry_index()
    registered = registry.get(cwd)

    if not discovered and cwd not in db_map and not registered:
        raise HTTPException(status_code=404, detail="Project not found")

    # session_count 与会话列表 API 保持一致；
    # task_count 由 _project_payload 基于 sessions + DB session_ids 去重计算
    sessions = discover_sessions(project_cwd=cwd)
    # chat_count 精确计算：扫描每个 chat 文件内容是否引用当前项目
    chats = _project_chats(cwd)
    return _project_payload(
        cwd,
        discovered,
        db_map.get(cwd),
        registered,
        sessions=sessions,
        chat_count=len(chats),
    )


@router.get("/{project_id}/sessions")
async def get_project_sessions(project_id: str, agent_id: Optional[str] = None):
    """项目下的会话列表（按项目根/cwd 过滤文件扫描结果）。"""
    cwd = _decode_id(project_id)
    sessions = discover_sessions(project_cwd=cwd, agent_id=agent_id)
    return {"sessions": sessions, "project_id": project_id, "cwd": cwd}


def _project_chats(cwd: str, agent_id: Optional[str] = None) -> list[dict]:
    """返回与项目 ``cwd`` 内容相关、但 ``project_root`` 为空的普通对话列表。

    通过扫描 chat 会话文件首部内容判定是否引用了当前项目（路径/项目名）。
    """
    items = discover_chats(agent_id=agent_id)
    result: list[dict] = []
    for it in items:
        file_path = it.get("file")
        if not file_path:
            continue
        if _session_references_project(file_path, cwd):
            result.append(it)
    return result


@router.get("/{project_id}/chats")
async def get_project_chats(project_id: str, agent_id: Optional[str] = None):
    """项目相关的普通对话（chats）— 不绑定项目但内容引用该项目的 chat。"""
    cwd = _decode_id(project_id)
    chats = _project_chats(cwd, agent_id=agent_id)
    return {"chats": chats, "project_id": project_id, "cwd": cwd}


@router.get("/{project_id}/tasks")
async def get_project_tasks(project_id: str, workspace_id: str = "default"):
    """项目下的任务（DB tasks 表 + source=exec 的文件会话）。"""
    cwd = _decode_id(project_id)

    # 1) DB 任务
    async with async_session_factory() as session:
        r = await session.execute(
            text(
                "SELECT id, prompt, agent_id, session_id, status, created_at "
                "FROM tasks WHERE workspace_id = :ws AND cwd = :cwd "
                "ORDER BY created_at DESC LIMIT 50"
            ),
            {"ws": workspace_id, "cwd": cwd},
        )
        rows = r.fetchall()
        db_tasks = [
            {
                "id": row[0],
                "prompt": row[1],
                "agent_id": row[2],
                "session_id": row[3],
                "status": row[4],
                "created_at": row[5],
                "source": "db",
            }
            for row in rows
        ]

    # 2) 文件会话中 source=exec 的（通过 Lark 面板下发的指令）
    db_session_ids = {t["session_id"] for t in db_tasks if t.get("session_id")}
    sessions = discover_sessions(project_cwd=cwd)
    file_tasks = []
    for s in sessions:
        if s.get("session_source") != "exec":
            continue
        sid = s.get("session_id") or s.get("id")
        if sid and sid in db_session_ids:
            continue
        file_tasks.append(
            {
                "id": sid,
                "prompt": s.get("title") or "",
                "agent_id": s.get("agent_id"),
                "session_id": sid,
                "status": s.get("status") or "completed",
                "created_at": s.get("created_at"),
                "source": "file",
            }
        )

    # 3) 合并并按时间倒序
    tasks = db_tasks + file_tasks
    tasks.sort(key=lambda t: t.get("created_at") or "", reverse=True)
    return {"tasks": tasks}


@router.delete("/{project_id}")
async def remove_project(project_id: str):
    """从已注册列表中移除项目（不删除文件、不影响历史会话/任务）。"""
    cwd = _decode_id(project_id)
    with _REGISTRY_LOCK:
        items = _load_registry()
        new_items = [it for it in items if it.get("cwd") != cwd]
        if len(new_items) == len(items):
            # 没有注册过；幂等返回成功
            return {"removed": False, "cwd": cwd}
        _save_registry(new_items)
    project_discovery.clear_cache()
    return {"removed": True, "cwd": cwd}


@router.post("/{project_id}/archive")
async def archive_project(project_id: str):
    """归档项目（软操作，不删除任何文件/数据）。"""
    cwd = _decode_id(project_id)
    changed = archive_store.archive_project(project_id)
    return {"archived": True, "changed": changed, "id": project_id, "cwd": cwd}


@router.post("/{project_id}/unarchive")
async def unarchive_project(project_id: str):
    """取消项目归档。"""
    cwd = _decode_id(project_id)
    changed = archive_store.unarchive_project(project_id)
    return {"archived": False, "changed": changed, "id": project_id, "cwd": cwd}
