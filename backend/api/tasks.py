"""
任务 API 路由。

提供 CRUD + approve/reject/retry/stop 操作。
"""

import asyncio
import json
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from backend.core.dependencies import (
    check_cwd_write_permission,
    encode_project_id,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.db.engine import async_session_factory
from backend.models.schemas import TaskCreate, TaskResponse, TaskListResponse, ApprovalAction
from backend.services.session_discovery import discover_sessions, find_session
from backend.services.task_service import task_service


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

ATTACHMENTS_DIR = Path(".tide/attachments/web")


def _safe_upload_name(filename: str) -> str:
    name = Path(filename or "attachment").name
    return "".join(ch if ch.isalnum() or ch in ".-_" else "_" for ch in name) or "attachment"


@router.post("", response_model=TaskResponse)
async def create_task(
    body: TaskCreate,
    current_user=Depends(get_optional_user),
):
    """创建任务"""
    _ensure_not_viewer(current_user)
    cwd = (body.cwd or "").strip()
    group_id = (body.group_id or "").strip() or None

    # 解析 group_id → cwd（仅在未显式提供 cwd 时取 primary 项目路径）
    if group_id and not cwd:
        from backend.services.project_group_service import project_group_service
        group_projects = await project_group_service.get_group_projects(group_id)
        if group_projects:
            primary = next(
                (p for p in group_projects if p.get("role") == "primary"),
                group_projects[0],
            )
            cwd = (primary.get("cwd") or "").strip()

    await check_cwd_write_permission(cwd or None, current_user)
    try:
        result = await task_service.create_task(
            workspace_id=body.workspace_id,
            prompt=body.prompt,
            agent_id=body.agent_id,
            model=body.model or "",
            cwd=cwd,
            attachments=body.attachments,
            session_id=body.session_id or "",
            group_id=group_id,
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create task")
    return result


@router.post("/attachments")
async def upload_task_attachments(
    files: list[UploadFile] = File(...),
    current_user=Depends(get_optional_user),
):
    """上传任务附件，返回可写入 TaskCreate.attachments 的本地路径列表。"""
    _ensure_not_viewer(current_user)
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    attachments: list[str] = []

    for upload in files:
        safe_name = _safe_upload_name(upload.filename or "attachment")
        stored_name = f"{uuid.uuid4().hex[:12]}-{safe_name}"
        target = ATTACHMENTS_DIR / stored_name
        try:
            with target.open("wb") as out:
                shutil.copyfileobj(upload.file, out)
        finally:
            await upload.close()
        attachments.append(str(target))

    return {"attachments": attachments}


async def _fetch_db_tasks(
    workspace_id: str,
    status: Optional[str],
    agent_id: Optional[str],
    project: Optional[str] = None,
    group_id: Optional[str] = None,
    session_id: Optional[str] = None,
    created_after: Optional[str] = None,
    created_before: Optional[str] = None,
) -> list[dict]:
    """直接查询 tasks 表，不做分页，返回完整列表（用于与文件源合并）。"""
    conditions = ["workspace_id = :workspace_id"]
    params: dict = {"workspace_id": workspace_id}
    if status:
        conditions.append("status = :status")
        params["status"] = status
    else:
        # 默认不返回 cancelled 状态的任务（如 auto-recovery 产生的）
        conditions.append("status != 'cancelled'")
    if agent_id:
        conditions.append("agent_id = :agent_id")
        params["agent_id"] = agent_id
    if project:
        # 匹配 cwd 等于项目路径，或位于项目子目录
        conditions.append("(cwd = :project OR cwd LIKE :project_prefix)")
        params["project"] = project
        params["project_prefix"] = project.rstrip("/") + "/%"
    if group_id:
        conditions.append("group_id = :group_id")
        params["group_id"] = group_id
    if session_id:
        conditions.append("session_id = :session_id")
        params["session_id"] = session_id
    if created_after:
        conditions.append("created_at >= :created_after")
        params["created_after"] = created_after
    if created_before:
        conditions.append("created_at <= :created_before")
        params["created_before"] = created_before
    where = " AND ".join(conditions)

    async with async_session_factory() as session:
        result = await session.execute(
            text(f"""
            SELECT id, workspace_id, plan_id, assignee_id, assignee_type,
                   chat_id, parent_task_id, prompt, cwd, model, agent_id,
                   session_id, status, result, attachments, output_path, worktree_path,
                   branch_name, diff_summary, test_result, priority, labels,
                   created_at, started_at, completed_at, duration_ms
            FROM tasks
            WHERE {where}
            ORDER BY created_at DESC
            """),
            params,
        )
        rows = result.fetchall()
    items = []
    for row in rows:
        d = dict(row._mapping)
        d["source"] = "db"
        items.append(d)
    return items


def _file_session_to_task(item: dict, workspace_id: str) -> dict:
    """把文件扫描得到的会话映射成 TaskResponse 兼容的 dict。"""
    return {
        "id": item.get("session_id") or item.get("id"),
        "workspace_id": workspace_id,
        "plan_id": None,
        "assignee_id": None,
        "assignee_type": "agent",
        "chat_id": None,
        "parent_task_id": None,
        "prompt": item.get("title") or "",
        "cwd": item.get("cwd"),
        "model": None,
        "agent_id": item.get("agent_id"),
        "session_id": item.get("session_id"),
        "status": item.get("status") or "completed",
        "result": None,
        "attachments": None,
        "output_path": item.get("file"),
        "worktree_path": None,
        "branch_name": None,
        "diff_summary": None,
        "test_result": None,
        "priority": 0,
        "labels": None,
        "created_at": item.get("created_at"),
        "started_at": None,
        "completed_at": item.get("last_active"),
        "duration_ms": None,
        "source": "file",
    }


def _sort_key(item: dict) -> str:
    """排序优先级：completed_at > created_at > last_active。"""
    for key in ("completed_at", "created_at", "last_active"):
        v = item.get(key)
        if v:
            return str(v)
    return ""


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    workspace_id: str = Query("default"),
    status: str = Query(None),
    agent_id: str = Query(None),
    project: str = Query(None, description="按项目根/cwd 过滤文件扫描结果"),
    group_id: Optional[str] = Query(None, description="按项目组过滤"),
    session_id: Optional[str] = Query(None, description="按会话 ID 过滤"),
    created_after: Optional[str] = Query(None, description="创建时间下界 (ISO datetime)"),
    created_before: Optional[str] = Query(None, description="创建时间上界 (ISO datetime)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_optional_user),
):
    """任务列表：合并 DB 任务 + 本地 Agent 会话文件扫描结果。

    - 当传入 ``group_id`` 时仅按 DB 中 ``tasks.group_id`` 过滤；文件扫描
      源不带项目组归属信息，故跳过文件源以避免误命中。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    # 1) DB 任务（全量，后面再分页）
    db_items = await _fetch_db_tasks(
        workspace_id,
        status,
        agent_id,
        project,
        group_id=group_id,
        session_id=session_id,
        created_after=created_after,
        created_before=created_before,
    )
    if accessible_pids is not None:
        db_items = [
            it for it in db_items
            if encode_project_id(it.get("cwd") or "") in accessible_pids
        ]

    # 2) 文件扫描会话
    merged: list[dict] = list(db_items)
    db_session_ids = {
        it.get("session_id") for it in db_items if it.get("session_id")
    }

    # 文件源只能产出已完成态；status 过滤若不为空且非 "completed"，则不纳入
    # 项目组过滤启用时跳过文件源（文件源无 group 归属信息）
    include_files = (not status or status == "completed") and not group_id
    if include_files:
        file_sessions = discover_sessions(project_cwd=project, agent_id=agent_id)
        for s in file_sessions:
            # 只包含 session_source == "exec" 的文件会话作为任务
            if s.get("session_source") != "exec":
                continue
            sid = s.get("session_id")
            if sid and sid in db_session_ids:
                continue
            # session_id 过滤
            if session_id and sid != session_id:
                continue
            # 创建时间范围过滤（ISO 字符串可按字典序比较）
            created_at = s.get("created_at") or s.get("last_active")
            if created_after and (not created_at or str(created_at) < created_after):
                continue
            if created_before and (not created_at or str(created_at) > created_before):
                continue
            if (
                accessible_pids is not None
                and encode_project_id(s.get("cwd") or "") not in accessible_pids
            ):
                continue
            merged.append(_file_session_to_task(s, workspace_id))

    # 3) 排序：按时间倒序
    merged.sort(key=_sort_key, reverse=True)

    # 4) 分页
    total = len(merged)
    offset = (page - 1) * page_size
    paged = merged[offset : offset + page_size]

    return {
        "items": paged,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def _strip_source_prefix(task_id: str) -> tuple[str, str]:
    """去除看板视图添加的 source 前缀（db: / file:），返回 (raw_id, source_hint)。"""
    if task_id.startswith("db:"):
        return task_id[3:], "db"
    if task_id.startswith("file:"):
        return task_id[5:], "file"
    return task_id, ""


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    workspace_id: str = Query("default"),
    current_user=Depends(get_optional_user),
):
    """任务详情。

    优先查 DB；DB 未命中时回退到文件扫描（session_discovery）
    返回从本地 Agent 会话文件推导出的任务视图，
    以保持与 /api/tasks 列表（合并了文件源）一致。

    task_id 支持带 source 前缀（db: / file:）——看板视图使用的格式。
    """
    raw_id, source_hint = _strip_source_prefix(task_id)

    # DB 查询（优先）
    if source_hint != "file":
        result = await task_service.get_task(raw_id)
        if result:
            return result

    # 文件来源 fallback：raw_id 实际上是 session_id
    file_session = find_session(raw_id)
    if file_session and file_session.get("session_source") == "exec":
        return _file_session_to_task(file_session, workspace_id)

    raise HTTPException(status_code=404, detail="Task not found")


@router.post("/{task_id}/stop")
async def stop_task(
    task_id: str,
    current_user=Depends(get_optional_user),
):
    """停止任务"""
    _ensure_not_viewer(current_user)
    raw_id, _ = _strip_source_prefix(task_id)
    existing = await task_service.get_task(raw_id)
    if existing:
        await check_cwd_write_permission(existing.get("cwd"), current_user)
    result = await task_service.stop_task(raw_id)
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.post("/{task_id}/approve")
async def approve_task(
    task_id: str,
    current_user=Depends(get_optional_user),
):
    """批准审批"""
    _ensure_not_viewer(current_user)
    raw_id, _ = _strip_source_prefix(task_id)
    existing = await task_service.get_task(raw_id)
    if existing:
        await check_cwd_write_permission(existing.get("cwd"), current_user)
    result = await task_service.approve_task(raw_id)
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.post("/{task_id}/reject")
async def reject_task(
    task_id: str,
    body: Optional[ApprovalAction] = None,
    current_user=Depends(get_optional_user),
):
    """拒绝审批"""
    _ensure_not_viewer(current_user)
    raw_id, _ = _strip_source_prefix(task_id)
    existing = await task_service.get_task(raw_id)
    if existing:
        await check_cwd_write_permission(existing.get("cwd"), current_user)
    reason = body.reason if body else ""
    result = await task_service.reject_task(raw_id, reason=reason)
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.post("/{task_id}/retry")
async def retry_task(
    task_id: str,
    current_user=Depends(get_optional_user),
):
    """重试失败任务"""
    _ensure_not_viewer(current_user)
    raw_id, _ = _strip_source_prefix(task_id)
    existing = await task_service.get_task(raw_id)
    if existing:
        await check_cwd_write_permission(existing.get("cwd"), current_user)
    result = await task_service.retry_task(raw_id)
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.get("/{task_id}/output")
async def stream_task_output(
    task_id: str,
    current_user=Depends(get_optional_user),
):
    """SSE 流式输出任务结果"""
    raw_id, _ = _strip_source_prefix(task_id)
    task = await task_service.get_task(raw_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_generator():
        # 先发送已有输出
        if task.get("result"):
            yield f"data: {json.dumps({'type': 'output', 'content': task['result']})}\n\n"

        # 如果任务还在运行，持续监听新输出
        if task.get("status") in ("queued", "running"):  
            last_len = len(task.get("result") or "")
            for _ in range(600):  # 最多等 10 分钟
                await asyncio.sleep(1)
                current = await task_service.get_task(raw_id)
                if not current:
                    break
                current_result = current.get("result") or ""
                if len(current_result) > last_len:
                    new_content = current_result[last_len:]
                    yield f"data: {json.dumps({'type': 'output', 'content': new_content})}\n\n"
                    last_len = len(current_result)
                if current.get("status") not in ("queued", "running"):
                    yield f"data: {json.dumps({'type': 'done', 'status': current['status']})}\n\n"
                    break
        else:
            # 任务已结束，发送 done 信号
            yield f"data: {json.dumps({'type': 'done', 'status': task['status']})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
