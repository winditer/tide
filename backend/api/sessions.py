"""会话 API：合并 SQLite tasks 表（按 session_id 聚合）+ 本地 Agent 会话文件扫描。

提供：
- GET  /api/sessions               会话列表（对齐 Lark /chats）
- GET  /api/sessions/{session_id}  会话详情（含对话消息流 + 关联任务）
- POST /api/sessions               新建会话（创建占位任务，Agent 启动后回写 session_id）
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text

from backend.core.dependencies import (
    check_cwd_write_permission,
    encode_project_id,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.db.engine import async_session_factory
from backend.services.archive_service import archive_store, resolve_show_archived
from backend.services.session_discovery import (
    discover_chats,
    discover_sessions,
    find_session,
    read_session_messages,
)
from backend.services.project_discovery import find_project_root
from backend.services.task_service import task_service

logger = logging.getLogger("tide.api.sessions")

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


def _sort_key(item: dict) -> str:
    return str(item.get("last_active") or "")


# ── Schemas ───────────────────────────────────────────


class SessionCreate(BaseModel):
    # 传 cwd → 项目会话（convo）；不传或空 → 普通对话（chat）
    project_cwd: Optional[str] = Field(
        default="", description="项目工作目录；留空则创建普通对话（chat）"
    )
    # 注意：所有字符串字段统一为 Optional，避免前端显式传 null 时 Pydantic 直接 422。
    # 真正的回退默认值在端点函数内处理，这里只做格式校验。
    agent_id: Optional[str] = Field("codex", description="Agent 标识")
    title: Optional[str] = Field(None, description="可选会话标题，作为初始 prompt")
    model: Optional[str] = None
    workspace_id: Optional[str] = Field("default", description="工作区 ID")
    session_type: Optional[str] = Field(
        default=None,
        description="会话类型：'convo'/'chat'，可选，默认根据是否提供 cwd 推断",
    )
    group_id: Optional[str] = Field(
        None,
        description="项目组 ID；选择项目组时会自动取 primary 项目的 cwd",
    )


# ── List ──────────────────────────────────────────────


@router.get("/list-for-project")
async def list_sessions_for_project(
    cwd: str = Query(..., description="项目工作目录"),
    current_user=Depends(get_optional_user),
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
        None, description="是否包含已归档会话；缺省读取 TIDE_SHOW_ARCHIVED"
    ),
    current_user=Depends(get_optional_user),
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
    group_id: Optional[str] = Query(None, description="按项目组过滤"),
    agent_id: Optional[str] = Query(None),
    type: Optional[str] = Query("all", description="会话类型过滤: all/project/chat"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    show_archived: Optional[bool] = Query(
        None, description="是否包含已归档会话；缺省读取 TIDE_SHOW_ARCHIVED"
    ),
    current_user=Depends(get_optional_user),
):
    """会话列表：DB 优先（按 session_id 聚合），文件扫描补充。支持 type 过滤。"""
    accessible_pids = await get_accessible_project_ids(current_user)
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
        if group_id:
            conditions.append("group_id = :group_id")
            params["group_id"] = group_id
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

    # 文件扫描补充：构建 session_id → file_meta 映射用于合并
    file_meta_map: dict[str, dict] = {}
    for s in discover_sessions(project_cwd=project, agent_id=agent_id):
        sid = s.get("session_id")
        if sid:
            file_meta_map[sid] = s

    # 用文件元数据丰富 DB sessions（补充 project_root / project_name / title）
    db_sids = {s["session_id"] for s in db_sessions if s.get("session_id")}
    for db_s in db_sessions:
        sid = db_s.get("session_id") or ""
        file_s = file_meta_map.get(sid)
        if file_s:
            if not db_s.get("project_root"):
                db_s["project_root"] = file_s.get("project_root")
            if not db_s.get("project_name"):
                db_s["project_name"] = file_s.get("project_name")
            if not db_s.get("title"):
                db_s["title"] = file_s.get("title")
        else:
            # 无对应文件时，从 cwd 计算 project_root
            cwd_val = db_s.get("cwd") or ""
            if cwd_val and not db_s.get("project_root"):
                pr = find_project_root(Path(cwd_val))
                if pr:
                    db_s["project_root"] = str(pr)
                    db_s["project_name"] = pr.name

    # 仅文件中存在的会话（DB 中无记录）
    file_sessions: list[dict] = []
    for sid, s in file_meta_map.items():
        if sid in db_sids:
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

    # 项目级权限过滤：非 admin 用户只能看到可访问项目下的会话；无 cwd 的会话(chat)对所有认证用户可见
    if accessible_pids is not None:
        merged = [
            it for it in merged
            if not (it.get("cwd") or "")
            or encode_project_id(it.get("cwd") or "") in accessible_pids
        ]

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
                SELECT id, prompt, agent_id, status, cwd, result,
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


def _synthesize_messages_from_tasks(tasks: list[dict]) -> list[dict]:
    """从任务数据合成对话消息列表（当会话文件不可用时的降级方案）。

    将每个任务的 prompt 作为 user 消息、result 作为 assistant 消息，
    按创建时间升序排列，形成完整的对话流。
    """
    messages: list[dict] = []
    # 按 created_at 升序处理（tasks 是 DESC 排序的）
    for task in reversed(tasks):
        prompt = (task.get("prompt") or "").strip()
        result = (task.get("result") or "").strip()
        created_at = task.get("created_at") or ""
        completed_at = task.get("completed_at") or ""

        if prompt:
            messages.append({
                "role": "user",
                "content": prompt,
                "timestamp": str(created_at) if created_at else None,
            })
        if result:
            messages.append({
                "role": "assistant",
                "content": result,
                "timestamp": str(completed_at or created_at) if (completed_at or created_at) else None,
            })
    return messages


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    """会话详情：返回会话元信息、对话消息流、关联任务。"""
    info = find_session(session_id)
    related = await _related_tasks(session_id, workspace_id)

    if info is None and not related:
        raise HTTPException(status_code=404, detail="Session not found")

    if info is None:
        # DB 中可能存在 session（聚合任务），文件未扫描到。降级返回任务聚合视图。
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

    # ── 消息来源策略 ──
    # 1. 优先从 JSONL 文件解析（已过滤 tool_result 噪音，仅保留 text 块）
    # 2. 如果文件消息缺少 assistant 回复，用 DB 任务数据补充
    # 3. 如果完全没有文件消息，从 DB 任务合成
    file_path = info.get("file")
    agent_id = info.get("agent_id") or "codex"
    file_messages = (
        read_session_messages(file_path, agent_id) if file_path else []
    )
    file_has_assistant = any(
        m.get("role") == "assistant" for m in file_messages
    )
    if file_messages and file_has_assistant:
        # 文件消息包含 assistant 回复 → 使用文件消息（更干净）
        messages = file_messages
    elif related:
        # 无文件消息或文件缺少 assistant → 从 DB 任务合成
        messages = _synthesize_messages_from_tasks(related)
    else:
        # DB 也没数据，使用任何已解析的文件消息
        messages = file_messages

    # Strip large 'result' field from tasks response (already included in messages)
    tasks_response = [
        {k: v for k, v in t.items() if k != "result"}
        for t in related
    ]

    return {
        "session": info,
        "messages": messages,
        "tasks": tasks_response,
    }


# ── Create ────────────────────────────────────────────


@router.post("")
async def create_session(
    body: SessionCreate,
    current_user=Depends(get_optional_user),
):
    """新建会话。

    通过创建一个占位任务来表达"开启会话"，Agent 真正启动后会回写 ``session_id``
    并写入 ``~/.<agent>/...`` 目录的 JSONL 文件。
    返回 ``session_id``（与 task.id 同步，便于前端立即跳转）。
    """
    _ensure_not_viewer(current_user)
    cwd = (body.project_cwd or "").strip()
    declared_type = (body.session_type or "").lower().strip()
    if declared_type == "chat":
        cwd = ""

    # 解析 group_id → cwd（仅在未显式提供 cwd 时取 primary 项目路径）
    group_id = (body.group_id or "").strip() or None
    if group_id and not cwd:
        from backend.services.project_group_service import project_group_service
        group_projects = await project_group_service.get_group_projects(group_id)
        if group_projects:
            primary = next(
                (p for p in group_projects if p.get("role") == "primary"),
                group_projects[0],
            )
            cwd = (primary.get("cwd") or "").strip()

    session_type = "convo" if cwd else "chat"
    await check_cwd_write_permission(cwd or None, current_user)

    default_prompt = "新会话" if session_type == "convo" else "新对话"
    prompt = (body.title or default_prompt).strip() or default_prompt

    # 字段回退：前端可能传 null/空字符串，统一兜底
    agent_id = (body.agent_id or "codex").strip() or "codex"
    workspace_id = (body.workspace_id or "default").strip() or "default"

    # 预先生成 session_id，确保 tasks 表 session_id 列非空，
    # 否则后续 get_session/list_sessions 按 session_id 查询会 404。
    session_id = str(uuid.uuid4())

    try:
        task = await task_service.create_task(
            workspace_id=workspace_id,
            prompt=prompt,
            agent_id=agent_id,
            model=body.model or "",
            cwd=cwd,
            attachments=[],
            session_id=session_id,
            group_id=group_id,
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not task:
        raise HTTPException(status_code=500, detail="Failed to create session")

    return {
        "session_id": session_id,
        "task_id": task.get("id"),
        "agent_id": agent_id,
        "cwd": cwd,
        "title": prompt,
        "status": task.get("status") or "queued",
        "session_type": session_type,
        "group_id": group_id,
    }


# ── Archive ───────────────────────────────────────────


@router.post("/{session_id}/archive")
async def archive_session(
    session_id: str,
    current_user=Depends(get_optional_user),
):
    """归档会话（软操作，不删除任何文件/数据）。"""
    _ensure_not_viewer(current_user)
    changed = archive_store.archive_session(session_id)
    return {"archived": True, "changed": changed, "id": session_id}


@router.post("/{session_id}/unarchive")
async def unarchive_session(
    session_id: str,
    current_user=Depends(get_optional_user),
):
    """取消会话归档。"""
    _ensure_not_viewer(current_user)
    changed = archive_store.unarchive_session(session_id)
    return {"archived": False, "changed": changed, "id": session_id}


# ── Artifacts ─────────────────────────────────


def _safe_json_loads(raw, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


@router.get("/{session_id}/artifacts")
async def get_session_artifacts(
    session_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    """汇总会话关联产物。

    产物来源：
    1. tasks.result 文本中的 markdown 链接与常见创建文件提示行（实时解析）。
    2. work_items.metadata.artifacts 中与该 session 关联任务产生的产物。

    响应格式：
    {"artifacts": [{id, label, url, type, created_at, task_id}]}
    """
    artifacts: list[dict] = []
    seen_keys: set = set()

    def _push(item: dict) -> None:
        url = (item.get("url") or "").strip()
        label = (item.get("label") or "").strip()
        if not url and not label:
            return
        key = (item.get("type") or "file", url, label)
        if key in seen_keys:
            return
        seen_keys.add(key)
        artifacts.append(item)

    # 1. 从 tasks 表提取
    try:
        async with async_session_factory() as session:
            r = await session.execute(
                text(
                    """
                    SELECT id, result, completed_at, created_at
                    FROM tasks
                    WHERE workspace_id = :ws AND session_id = :sid
                    ORDER BY created_at ASC
                    """
                ),
                {"ws": workspace_id, "sid": session_id},
            )
            task_rows = r.fetchall()
    except Exception:
        logger.exception("query tasks for session artifacts failed: sid=%s", session_id)
        task_rows = []

    task_ids: list[str] = []
    for row in task_rows:
        d = dict(row._mapping)
        tid = str(d.get("id") or "")
        task_ids.append(tid)
        result_text = d.get("result")
        if not result_text or not isinstance(result_text, str):
            continue
        created_at = str(d.get("completed_at") or d.get("created_at") or "")
        try:
            extracted = task_service._extract_artifacts_from_result(result_text)
        except Exception:
            logger.debug("extract artifacts failed for task=%s", tid[:8], exc_info=True)
            extracted = []
        for art in extracted:
            _push({
                "id": str(uuid.uuid4()),
                "label": art.get("label") or "",
                "url": art.get("url") or "",
                "type": art.get("type") or "file",
                "created_at": created_at,
                "task_id": tid,
            })

    # 2. 从 work_items.metadata.artifacts 提取与该 session 关联的产物
    if task_ids:
        try:
            async with async_session_factory() as session:
                r = await session.execute(
                    text(
                        """
                        SELECT DISTINCT wi.id, wi.metadata
                        FROM work_items wi
                        JOIN work_item_transitions wit
                          ON wit.work_item_id = wi.id
                        WHERE wit.task_id IN :tids
                        """
                    ).bindparams(
                        bindparam("tids", expanding=True)
                    ),
                    {"tids": task_ids},
                )
                wi_rows = r.fetchall()
        except Exception:
            logger.exception(
                "query work_items for session artifacts failed: sid=%s", session_id,
            )
            wi_rows = []

        task_id_set = set(task_ids)
        for row in wi_rows:
            d = dict(row._mapping)
            metadata = _safe_json_loads(d.get("metadata"), {}) or {}
            wi_artifacts = metadata.get("artifacts") if isinstance(metadata, dict) else None
            if not isinstance(wi_artifacts, list):
                continue
            wid = str(d.get("id") or "")
            for art in wi_artifacts:
                if not isinstance(art, dict):
                    continue
                # 仅保留当前 session 下任务产生的产物
                art_task = str(art.get("task_id") or "")
                if art_task and art_task not in task_id_set:
                    continue
                art_id = str(art.get("id") or uuid.uuid4())
                url = art.get("url") or ""
                # 本地文件产物：如果 url 为空且拥有 file_path，生成 work-item content API URL
                if not url and art.get("type") == "file" and art.get("file_path"):
                    url = f"/api/work-items/{wid}/artifacts/{art_id}/content"
                label = art.get("label") or art.get("file_path") or ""
                a_type = art.get("type") or "file"
                if a_type not in ("file", "link", "markdown"):
                    # commit/url 等统一归为 link
                    a_type = "link" if str(url).startswith(("http://", "https://")) else "file"
                _push({
                    "id": art_id,
                    "label": label,
                    "url": url,
                    "type": a_type,
                    "created_at": str(art.get("created_at") or ""),
                    "task_id": art_task,
                })

    return {"artifacts": artifacts}
