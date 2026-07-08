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

import asyncio
import base64
import binascii
import json
import logging
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from backend.core.dependencies import get_current_user, get_optional_user
from backend.db.engine import async_session_factory
from backend.models.schemas import (
    FreeformStatusListUpdate,
    ProjectSettingsResponse,
    ProjectSettingsUpdate,
)
from backend.runtime.config import ensure_user_dir, project_dir
from backend.runtime.git_utils import git_clone
from backend.services import project_discovery
from backend.services.archive_service import archive_store, resolve_show_archived
from backend.services.session_discovery import (
    discover_chats,
    discover_sessions,
)
from backend.services.work_item_service import work_item_service

logger = logging.getLogger("tide.api.projects")

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


# ---------- 已注册项目（用户主动新建/添加的目录） ----------

REGISTRY_PATH = Path(
    os.getenv(
        "TIDE_PROJECTS_FILE",
        str(Path.home() / ".tide" / "registered_projects.json"),
    )
).expanduser()
_REGISTRY_LOCK = threading.Lock()


class ProjectCreate(BaseModel):
    name: str  # 项目名（必填，作为目录名）
    mode: Literal["new", "clone"] = "new"
    repo_url: Optional[str] = None  # clone 模式必填
    branch: Optional[str] = None  # 可选指定分支
    tags: Optional[list[str]] = None
    credential_type: Optional[str] = None  # ssh_agent | ssh_key | token
    ssh_key_path: Optional[str] = None
    access_token: Optional[str] = None


def _parse_project_roots() -> list[str]:
    """解析可用项目根目录列表。

    优先使用 ``CODEX_PROJECTS_ROOT``（支持逗号/分号分隔多个）；
    未设置时回退到 ``CODEX_DEFAULT_CWD`` 的父目录。
    """
    raw = (os.getenv("CODEX_PROJECTS_ROOT", "") or "").strip()
    roots: list[str] = []
    if raw:
        for item in re.split(r"[,;]", raw):
            s = item.strip()
            if not s:
                continue
            try:
                roots.append(str(Path(s).expanduser().resolve()))
            except OSError:
                roots.append(str(Path(s).expanduser()))
    if not roots:
        default_cwd = os.getenv("CODEX_DEFAULT_CWD", "") or os.getcwd()
        try:
            roots.append(str(Path(default_cwd).expanduser().resolve().parent))
        except OSError:
            roots.append(str(Path(default_cwd).expanduser().parent))
    # 去重但保留顺序
    seen: set[str] = set()
    unique: list[str] = []
    for r in roots:
        if r and r not in seen:
            seen.add(r)
            unique.append(r)
    return unique


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


# ---------- 项目名校验 ----------

_PROJECT_NAME_PATTERN = re.compile(r"^[\w\u4e00-\u9fff][\w\u4e00-\u9fff\-\.]*$")


def _validate_project_name(name: str) -> str:
    """校验项目名称安全性，返回清理后的名称。"""
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    if ".." in name or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="项目名称不能包含 .. / \\")
    if not _PROJECT_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=400,
            detail="项目名称只能包含字母、数字、中文、-、_、.",
        )
    return name


def _update_project_status(
    project_id: str, status: str, error: Optional[str] = None
) -> None:
    """更新注册表中项目的状态字段。"""
    cwd = _decode_id(project_id)
    with _REGISTRY_LOCK:
        items = _load_registry()
        for it in items:
            if it.get("cwd") == cwd:
                it["status"] = status
                it["error"] = error
                break
        _save_registry(items)


async def _async_clone_project(
    project_id: str,
    repo_url: str,
    target_dir: Path,
    branch: Optional[str],
) -> None:
    """后台异步克隆仓库；完成后更新注册表 status。

    从 ``project_settings.metadata.git_config`` 读取认证配置传给 git_clone，
    使得 ssh_key / token 模式下创建项目时也能正确鉴权。
    """
    git_config: Optional[dict] = None
    try:
        git_config = await work_item_service.get_project_git_config(project_id)
    except Exception:  # noqa: BLE001
        logger.exception(
            "[projects] load git_config for clone failed: project_id=%s", project_id
        )

    try:
        success, msg = await git_clone(
            repo_url, str(target_dir), branch, git_config=git_config
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "[projects] async clone crashed: project_id=%s repo=%s",
            project_id,
            repo_url,
        )
        _update_project_status(project_id, "error", error=f"{type(exc).__name__}: {exc}")
        return

    if success:
        _update_project_status(project_id, "ready")
        logger.info(
            "[projects] async clone done: project_id=%s target=%s",
            project_id,
            target_dir,
        )
    else:
        _update_project_status(project_id, "error", error=msg[:1000] if msg else "clone failed")
        logger.warning(
            "[projects] async clone failed: project_id=%s repo=%s msg=%s",
            project_id,
            repo_url,
            msg,
        )


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
    runtime_status = "active" if running > 0 else "idle"
    # 注册表中的生命周期状态：ready / initializing / error
    # 老数据没有该字段时默认 ready，保持向后兼容。
    lifecycle_status = (registered or {}).get("status") or "ready"
    lifecycle_error = (registered or {}).get("error")

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
        "status": lifecycle_status,
        "runtime_status": runtime_status,
        "error": lifecycle_error,
        "agents": agents,
        "session_count": session_count,
        # ``chat_count`` 仅在项目详情接口中精确计算（按会话内容引用匹配）；
        # 列表接口为避免对每个项目扫描所有 chat 文件内容（性能问题），
        # 调用方传 ``None`` 时这里直接返回 ``None``，前端展示 "—"。
        "chat_count": None if chat_count is None else int(chat_count),
        "registered": bool(registered),
        "creator_id": (registered or {}).get("creator_id"),
        "tags": (registered or {}).get("tags") or [],
        "archived": bool(archived),
    }


# ---------- 路由 ----------


@router.get("")
async def list_projects(
    workspace_id: str = "default",
    show_archived: Optional[bool] = Query(
        None, description="是否包含已归档项目；缺省读取 TIDE_SHOW_ARCHIVED"
    ),
    search: Optional[str] = Query(None, description="按项目名称或标签模糊搜索"),
    current_user=Depends(get_optional_user),
):
    """项目列表 — 文件发现 + DB 聚合 + 已注册项目合并。

    ``chat_count`` 性能折中策略：列表接口不返回项目维度的 chat_count（设为 ``None``）。
    精确的 chat_count 仅在项目详情接口 ``GET /api/projects/{id}`` 中按内容引用匹配计算
    （见 ``get_project`` / ``_project_chats``）；前端列表卡片在 chat_count 为空时显示 "—"。

    归档过滤：``show_archived`` 缺省读取 ``TIDE_SHOW_ARCHIVED`` 环境变量；
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

    # 排除 .tide/worktrees/ 下的临时工作树路径，
    # 防止 Plan 执行产生的 worktree 被误列为独立项目。
    # 同时排除客户端对话工作目录（如 ~/Documents/Codex/、~/.codex/、~/.qoder/cache/）
    cwds = {
        c for c in cwds
        if not project_discovery.is_worktree_path(c)
        and not project_discovery._is_excluded_path(c)
    }

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

    # 项目级权限过滤：非 admin 用户只能看到其可访问的项目
    accessible_pids: Optional[set[str]] = None
    if current_user and current_user.get("role") != "admin":
        from backend.services.auth_service import auth_service
        accessible = await auth_service.get_user_accessible_projects(current_user["id"])
        if "*" not in accessible:
            accessible_pids = set(accessible)

    projects: list[dict] = []
    for cwd in cwds:
        pid = _encode_id(cwd)
        is_archived = pid in archived_ids
        if is_archived and not include_archived:
            continue
        if accessible_pids is not None and pid not in accessible_pids:
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
    # 模糊搜索过滤
    if search:
        search_lower = search.lower().strip()
        projects = [
            p for p in projects
            if search_lower in (p.get("name", "") or "").lower()
            or search_lower in (p.get("cwd", "") or "").lower()
            or any(search_lower in (tag or "").lower() for tag in (p.get("tags") or []))
        ]

    projects.sort(key=lambda p: (p.get("last_active") or ""), reverse=True)
    return {"projects": projects}


@router.get("/roots")
async def get_project_roots(current_user=Depends(get_optional_user)):
    """返回可选项目根目录。

    前端创建/添加项目弹窗用于拼接完整路径。
    """
    roots = _parse_project_roots()
    return {"roots": roots, "default": roots[0] if roots else None}


@router.post("")
async def create_project(
    body: ProjectCreate,
    current_user=Depends(get_current_user),
):
    """创建项目（用户目录隔离 + 可选异步 clone）。

    路径隔离规则：``{TIDE_DATA_DIR}/users/{user_id}/{name}``。
    - mode == "new"：mkdir + git init，状态直接为 ``ready``；
    - mode == "clone"：先将条目写入注册表（status=initializing），
      后台任务完成后更新为 ``ready`` / ``error``。
    """
    _ensure_not_viewer(current_user)
    if not current_user or not current_user.get("id"):
        raise HTTPException(status_code=401, detail="未登录用户无法创建项目")

    # 1. 校验名称
    name = _validate_project_name(body.name)

    # 2. 计算路径并检查冲突
    user_id = current_user["id"]
    target = project_dir(user_id, name)
    if target.exists():
        raise HTTPException(status_code=409, detail=f"项目目录已存在: {name}")

    # 3. 确保用户根目录存在
    try:
        ensure_user_dir(user_id)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"无法创建用户目录（请检查 TIDE_DATA_DIR 配置）: {exc}",
        ) from exc

    # 4. 根据 mode 处理
    cwd = str(target)
    if body.mode == "new":
        try:
            target.mkdir(parents=True, exist_ok=False)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"创建项目目录失败: {exc}",
            ) from exc
        proc = await asyncio.create_subprocess_exec(
            "git",
            "init",
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        if proc.returncode != 0:
            logger.warning(
                "[projects] git init returned non-zero: cwd=%s code=%s",
                cwd,
                proc.returncode,
            )
        status = "ready"
    else:  # clone
        if not body.repo_url:
            raise HTTPException(
                status_code=400, detail="clone 模式必须提供 repo_url"
            )
        status = "initializing"

    # 5. 写入注册表
    now_iso = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    with _REGISTRY_LOCK:
        items = _load_registry()
        existing = next((it for it in items if it.get("cwd") == cwd), None)
        if existing:
            existing["name"] = name
            existing["tags"] = list(body.tags or existing.get("tags") or [])
            existing["creator_id"] = user_id
            existing["status"] = status
            existing["error"] = None
        else:
            items.append(
                {
                    "cwd": cwd,
                    "name": name,
                    "tags": list(body.tags or []),
                    "creator_id": user_id,
                    "status": status,
                    "error": None,
                    "added_at": now_iso,
                }
            )
        _save_registry(items)

    project_discovery.clear_cache()
    project_id = _encode_id(cwd)

    # 6. 创建者自动成为项目 admin
    member_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    async with async_session_factory() as session:
        await session.execute(
            text(
                """
                INSERT OR IGNORE INTO project_members
                    (id, project_id, user_id, role, created_at)
                VALUES (:id, :project_id, :user_id, :role, :created_at)
                """
            ),
            {
                "id": member_id,
                "project_id": project_id,
                "user_id": user_id,
                "role": "admin",
                "created_at": now,
            },
        )
        await session.commit()

    # 7. clone 模式：写入 git_config、启动后台克隆
    if body.mode == "clone":
        git_config = {
            "repo_url": body.repo_url,
            "default_branch": body.branch or "",
            "credential_type": body.credential_type or "ssh_agent",
            "auto_push": True,
        }
        if body.credential_type == "ssh_key" and body.ssh_key_path:
            git_config["ssh_key_path"] = body.ssh_key_path
        if body.credential_type == "token" and body.access_token:
            git_config["access_token"] = body.access_token
        try:
            settings = await work_item_service.get_project_settings(project_id)
            metadata = (settings or {}).get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata) if metadata else {}
                except json.JSONDecodeError:
                    metadata = {}
            if not isinstance(metadata, dict):
                metadata = {}
            metadata["git_config"] = git_config
            await work_item_service.update_project_metadata(project_id, metadata)
        except Exception:  # noqa: BLE001
            logger.exception(
                "[projects] persist git_config failed: project_id=%s", project_id
            )

        asyncio.create_task(
            _async_clone_project(
                project_id=project_id,
                repo_url=body.repo_url,
                target_dir=target,
                branch=body.branch,
            )
        )

    # 8. 返回创建后的项目数据
    discovered_list = project_discovery.discover_projects()
    discovered = next((p for p in discovered_list if p.get("cwd") == cwd), None)
    db_map = await _aggregate_db_stats("default")
    registry = _registry_index()
    return _project_payload(cwd, discovered, db_map.get(cwd), registry.get(cwd))


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    workspace_id: str = "default",
    current_user=Depends(get_optional_user),
):
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
async def get_project_sessions(
    project_id: str,
    agent_id: Optional[str] = None,
    current_user=Depends(get_optional_user),
):
    """项目下的会话列表（按项目根/cwd 过滤文件扫描结果）。"""
    cwd = _decode_id(project_id)
    sessions = discover_sessions(project_cwd=cwd, agent_id=agent_id)
    return {"sessions": sessions, "project_id": project_id, "cwd": cwd}


def _project_chats(cwd: str, agent_id: Optional[str] = None) -> list[dict]:
    """返回与项目 cwd 相关、但 project_root 为空的普通对话列表。"""
    return discover_chats(project_cwd=cwd, agent_id=agent_id)


@router.get("/{project_id}/chats")
async def get_project_chats(
    project_id: str,
    agent_id: Optional[str] = None,
    current_user=Depends(get_optional_user),
):
    """项目相关的普通对话（chats）— 不绑定项目但内容引用该项目的 chat。"""
    cwd = _decode_id(project_id)
    chats = _project_chats(cwd, agent_id=agent_id)
    return {"chats": chats, "project_id": project_id, "cwd": cwd}


@router.get("/{project_id}/tasks")
async def get_project_tasks(
    project_id: str,
    workspace_id: str = "default",
    current_user=Depends(get_optional_user),
):
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
async def remove_project(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """从已注册列表中移除项目（不删除文件、不影响历史会话/任务）。"""
    _ensure_not_viewer(current_user)
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
async def archive_project(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """归档项目（软操作，不删除任何文件/数据）。"""
    _ensure_not_viewer(current_user)
    cwd = _decode_id(project_id)
    changed = archive_store.archive_project(project_id)
    return {"archived": True, "changed": changed, "id": project_id, "cwd": cwd}


@router.post("/{project_id}/unarchive")
async def unarchive_project(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """取消项目归档。"""
    _ensure_not_viewer(current_user)
    cwd = _decode_id(project_id)
    changed = archive_store.unarchive_project(project_id)
    return {"archived": False, "changed": changed, "id": project_id, "cwd": cwd}


# ---------- 项目-工作流绑定 ----------


@router.put("/{project_id}/workflow", response_model=ProjectSettingsResponse)
async def set_project_workflow(
    project_id: str,
    body: ProjectSettingsUpdate,
    current_user=Depends(get_optional_user),
):
    """绑定项目到工作流 / 设置项目流转模式。"""
    _ensure_not_viewer(current_user)
    flow_mode = body.flow_mode
    valid_modes = {"default_workflow", "custom_workflow", "freeform"}
    if flow_mode is not None and flow_mode not in valid_modes:
        raise HTTPException(status_code=400, detail=f"invalid flow_mode: {flow_mode}")
    # freeform 无需绑定工作流；default_workflow 使用系统默认工作流也无需显式绑定；
    # 仅 custom_workflow 必须绑定一个工作流。
    if flow_mode == "custom_workflow" and not body.workflow_id:
        raise HTTPException(status_code=400, detail="workflow_id is required")
    settings = await work_item_service.set_project_workflow(
        project_id=project_id, workflow_id=body.workflow_id, flow_mode=flow_mode
    )
    if not settings:
        raise HTTPException(status_code=500, detail="Failed to update project settings")
    return settings


@router.get("/{project_id}/workflow", response_model=ProjectSettingsResponse)
async def get_project_workflow(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """获取项目的工作流绑定信息。"""
    settings = await work_item_service.get_project_settings(project_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Project workflow not bound")
    # own_flow_mode：项目自身显式设置的模式（供设置页回显，不受项目组继承影响），
    # 避免用户选择「默认工作流」后被项目组的 freeform 覆盖。
    settings["own_flow_mode"] = settings.get("flow_mode") or "default_workflow"
    # flow_mode 采用继承链（项目级 > 项目组级 > 系统默认），供看板/工作项运行时使用，
    # 使项目组设为 freeform 时子项目前端也能识别为 freeform。
    settings["flow_mode"] = await work_item_service.get_effective_flow_mode(
        project_id, settings=settings
    )
    return settings


@router.delete("/{project_id}/workflow")
async def remove_project_workflow(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """解绑项目工作流。"""
    _ensure_not_viewer(current_user)
    removed = await work_item_service.remove_project_workflow(project_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Project workflow not bound")
    return {"ok": True, "project_id": project_id}


# ---------- 项目 Git 仓库配置 ----------


class GitConfigUpdate(BaseModel):
    repo_url: str = ""
    default_branch: str = "main"
    # ssh_agent | ssh_key | token
    credential_type: Literal["ssh_agent", "ssh_key", "token"] = "ssh_agent"
    auto_push: bool = True
    ssh_key_path: Optional[str] = None  # ssh_key 模式时的私钥路径
    access_token: Optional[str] = None  # token 模式时的 Personal Access Token


@router.put("/{project_id}/git-config")
async def set_project_git_config(
    project_id: str,
    body: GitConfigUpdate,
    current_user=Depends(get_optional_user),
):
    """设置项目的 Git 仓库配置。写入 ``project_settings.metadata.git_config``。"""
    _ensure_not_viewer(current_user)
    settings = await work_item_service.get_project_settings(project_id)
    metadata = (settings or {}).get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata) if metadata else {}
        except json.JSONDecodeError:
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    git_config = body.dict()
    # 清理无关字段：对应认证方式以外的敏感字段一律置空，避免误用旧值
    cred_type = git_config.get("credential_type", "ssh_agent")
    if cred_type != "ssh_key":
        git_config["ssh_key_path"] = None
    if cred_type != "token":
        git_config["access_token"] = None
    metadata["git_config"] = git_config
    await work_item_service.update_project_metadata(project_id, metadata)
    return {"ok": True, "git_config": git_config}


@router.get("/{project_id}/git-config")
async def get_project_git_config(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """获取项目的 Git 仓库配置。未配置时返回空对象。"""
    return await work_item_service.get_project_git_config(project_id)


# ---------- freeform 状态列表配置 ----------


@router.get("/{project_id}/freeform-status")
async def get_freeform_status(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """获取项目的 freeform 状态列表配置，无配置时返回默认值。"""
    status_list = await work_item_service.get_freeform_status_list(project_id)
    return {"status_list": status_list}


@router.put("/{project_id}/freeform-status")
async def set_freeform_status(
    project_id: str,
    body: FreeformStatusListUpdate,
    current_user=Depends(get_optional_user),
):
    """保存 freeform 状态列表配置到 project_settings.metadata。"""
    _ensure_not_viewer(current_user)
    status_list = await work_item_service.set_freeform_status_list(
        project_id, [it.dict() for it in body.status_list]
    )
    return {"status_list": status_list}


@router.post("/{project_id}/clone")
async def trigger_clone(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """手动触发 git clone。

    当项目目录不存在（从未 clone）或状态为 error 时可以重新触发。
    从 project_settings.metadata.git_config 中读取 repo_url 和认证信息。
    """
    _ensure_not_viewer(current_user)
    cwd = _decode_id(project_id)

    # 读取 git_config
    git_config = await work_item_service.get_project_git_config(project_id)
    if not git_config or not git_config.get("repo_url"):
        raise HTTPException(
            status_code=400,
            detail="请先在项目设置中配置 Git 仓库地址",
        )

    target_dir = Path(cwd)

    # 如果目录已经存在且有 .git，说明已经 clone 过
    if target_dir.exists() and (target_dir / ".git").exists():
        raise HTTPException(
            status_code=409,
            detail="项目目录已存在且包含 Git 仓库，无需重新克隆",
        )

    # 如果目录存在但为空或 clone 失败残留，先清理
    if target_dir.exists():
        import shutil
        try:
            shutil.rmtree(target_dir)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"清理失败目录时出错: {exc}",
            ) from exc

    # 确保父目录存在
    target_dir.parent.mkdir(parents=True, exist_ok=True)

    # 更新状态为 initializing
    _update_project_status(project_id, "initializing")
    project_discovery.clear_cache()

    # 启动后台异步 clone
    repo_url = git_config["repo_url"]
    branch = git_config.get("default_branch") or None
    asyncio.create_task(
        _async_clone_project(
            project_id=project_id,
            repo_url=repo_url,
            target_dir=target_dir,
            branch=branch,
        )
    )

    return {"ok": True, "status": "initializing", "message": "已触发克隆，请稍后刷新查看状态"}


@router.delete("/{project_id}/clone")
async def delete_repository(
    project_id: str,
    current_user=Depends(get_optional_user),
):
    """删除项目的已克隆仓库文件，允许重新克隆。

    - 删除整个项目工作目录
    - 保留项目注册表记录（允许重新克隆）
    - 更新项目状态
    """
    _ensure_not_viewer(current_user)
    cwd = _decode_id(project_id)
    target_dir = Path(cwd)

    # 检查目录存在性
    if not target_dir.exists() or not (target_dir / ".git").exists():
        raise HTTPException(
            status_code=404,
            detail="项目仓库不存在或未克隆",
        )

    # 删除整个项目目录
    import shutil
    try:
        shutil.rmtree(target_dir)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"删除仓库失败: {exc}",
        ) from exc

    # 更新注册表状态为未克隆（不要用 "ready"，那表示已克隆好）
    _update_project_status(project_id, "not_cloned")
    # 清除缓存让下次查询时重新发现状态
    project_discovery.clear_cache()

    return {"ok": True, "message": "仓库已删除，可重新克隆"}
