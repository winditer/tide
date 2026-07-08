"""项目组 API 路由。"""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

from backend.core.dependencies import get_optional_user
from backend.db.engine import async_session_factory
from backend.models.schemas import (
    ProjectGroupCreate,
    ProjectGroupMemberAdd,
    ProjectGroupUpdate,
)
from pathlib import Path

from backend.runtime.config import TIDE_REQUIRE_AUTH
from backend.runtime.git_utils import git_command, git_log_files
from backend.api.git_audit import (
    _parse_log_output,
    _group_by_work_item,
    _group_by_session,
    _group_by_branch,
    _group_by_version,
)
from backend.services.project_group_service import project_group_service
from backend.services.workflow_service import workflow_service

logger = logging.getLogger("tide.api.project_groups")

router = APIRouter(prefix="/api/project-groups", tags=["project-groups"])


_VALID_GROUP_USER_ROLES = {"owner", "member", "viewer"}


async def _ensure_group_exists(group_id: str) -> dict:
    group = await project_group_service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Project group not found")
    return group


async def _group_member_paths(group_id: str) -> tuple[list[str], list[str]]:
    """返回 (project_ids, cwds) 两个列表。"""
    projects = await project_group_service.get_group_projects(group_id)
    project_ids = [p["project_id"] for p in projects if p.get("project_id")]
    cwds = [p["cwd"] for p in projects if p.get("cwd")]
    return project_ids, cwds


def _build_in_clause(field: str, values: list[str], prefix: str) -> tuple[str, dict]:
    """构造 IN 子句与参数字典。空列表返回 "1=0" 以默认不命中。"""
    if not values:
        return "1=0", {}
    placeholders = []
    params: dict = {}
    for idx, v in enumerate(values):
        key = f"{prefix}{idx}"
        placeholders.append(f":{key}")
        params[key] = v
    return f"{field} IN ({', '.join(placeholders)})", params


# ── 用户成员权限工具 ──────────────────────────────────────


def _is_global_admin(user: Optional[dict]) -> bool:
    return bool(user) and (user or {}).get("role") == "admin"


def _validate_group_user_role(role: Optional[str]) -> str:
    if role is None:
        return "member"
    if role not in _VALID_GROUP_USER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role: {role}. Must be one of {sorted(_VALID_GROUP_USER_ROLES)}",
        )
    return role


async def _get_group_user_role(
    session, group_id: str, user_id: str
) -> Optional[str]:
    result = await session.execute(
        text(
            "SELECT role FROM project_group_user_members"
            " WHERE group_id = :gid AND user_id = :uid LIMIT 1"
        ),
        {"gid": group_id, "uid": user_id},
    )
    row = result.fetchone()
    return row[0] if row else None


async def _ensure_can_manage_group_users(
    session, group_id: str, current_user: Optional[dict]
) -> None:
    """全局 admin 或项目组 owner 才能管理用户成员。"""
    if not current_user:
        # 未启用强制认证 → 放行
        return
    if _is_global_admin(current_user):
        return
    role = await _get_group_user_role(session, group_id, current_user["id"])
    if role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project group owner or global admin can manage members",
        )


async def _ensure_can_view_group_users(
    session, group_id: str, current_user: Optional[dict]
) -> None:
    if not current_user:
        return
    if _is_global_admin(current_user):
        return
    role = await _get_group_user_role(session, group_id, current_user["id"])
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this project group",
        )


@router.get("")
async def list_project_groups(
    workspace_id: str = Query(default="default"),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """列出当前 workspace 的项目组（受用户成员过滤）。

    过滤规则：
    - 未启用 ``TIDE_REQUIRE_AUTH`` 或未提供 token → 不过滤，返回全部；
    - 全局 admin → 不过滤，返回全部；
    - 其他认证用户 → 仅返回其在 ``project_group_user_members`` 中有记录的项目组。
    """
    try:
        groups = await project_group_service.list_groups(workspace_id)
    except Exception as exc:
        logger.exception("Failed to list project groups for workspace %s: %s", workspace_id, exc)
        raise HTTPException(status_code=500, detail="Failed to list project groups")

    # 未启认证或全局 admin → 不过滤
    if not TIDE_REQUIRE_AUTH or not current_user or _is_global_admin(current_user):
        return {"groups": groups}

    # 查询当前用户可访问的项目组 ID
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT group_id FROM project_group_user_members WHERE user_id = :uid"
            ),
            {"uid": current_user["id"]},
        )
        accessible_ids = {row[0] for row in result.fetchall()}

    filtered = [g for g in groups if g.get("id") in accessible_ids]
    return {"groups": filtered}


@router.post("")
async def create_project_group(
    body: ProjectGroupCreate,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """创建项目组。创建后自动将当前用户加为 owner。"""
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")

    # 优先使用当前登录用户的 display_name / username 作为 created_by；
    # 仅当未启用强制认证、且 body 显式传入时，才使用 body.created_by。
    creator_label: Optional[str] = None
    if current_user:
        creator_label = (
            current_user.get("display_name")
            or current_user.get("username")
            or current_user.get("id")
        )
    if not creator_label and body.created_by:
        creator_label = body.created_by

    try:
        group = await project_group_service.create_group(
            workspace_id=body.workspace_id,
            name=body.name.strip(),
            description=body.description,
            created_by=creator_label,
            project_ids=body.project_ids,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to create project group %s: %s", body.name, exc)
        raise HTTPException(status_code=500, detail="Failed to create project group")

    # 创建者自动成为项目组 owner
    if current_user and current_user.get("id") and group and group.get("id"):
        try:
            async with async_session_factory() as session:
                await session.execute(
                    text(
                        """
                        INSERT OR IGNORE INTO project_group_user_members
                            (id, group_id, user_id, role, created_at)
                        VALUES (:id, :group_id, :user_id, 'owner', :created_at)
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "group_id": group["id"],
                        "user_id": current_user["id"],
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                await session.commit()
        except Exception as exc:
            logger.warning(
                "Failed to seed creator %s as owner of group %s: %s",
                current_user.get("id"),
                group["id"],
                exc,
            )

    return group


@router.get("/{group_id}")
async def get_project_group(group_id: str):
    """获取项目组详情（含成员列表）。"""
    group = await project_group_service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Project group not found")
    return group


@router.put("/{group_id}")
async def update_project_group(group_id: str, body: ProjectGroupUpdate):
    """更新项目组。"""
    existing = await project_group_service.get_group(group_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Project group not found")
    group = await project_group_service.update_group(
        group_id=group_id,
        name=body.name,
        description=body.description,
    )
    return group


@router.delete("/{group_id}")
async def delete_project_group(group_id: str):
    """删除项目组。"""
    existing = await project_group_service.get_group(group_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Project group not found")
    await project_group_service.delete_group(group_id)
    return {"ok": True}


@router.post("/{group_id}/members")
async def add_group_member(group_id: str, body: ProjectGroupMemberAdd):
    """添加成员项目到项目组。"""
    existing = await project_group_service.get_group(group_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Project group not found")
    member = await project_group_service.add_member(
        group_id=group_id,
        project_id=body.project_id,
        role=body.role,
    )

    # 同步项目组用户成员到新加入的项目（project_members）
    try:
        async with async_session_factory() as session:
            group_users = await session.execute(
                text(
                    "SELECT user_id, role FROM project_group_user_members"
                    " WHERE group_id = :group_id"
                ),
                {"group_id": group_id},
            )
            rows = group_users.fetchall()
            for row in rows:
                await session.execute(
                    text(
                        "INSERT OR IGNORE INTO project_members"
                        " (id, project_id, user_id, role)"
                        " VALUES (:id, :project_id, :user_id, :role)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "project_id": body.project_id,
                        "user_id": row[0],
                        "role": row[1],
                    },
                )
            await session.commit()
    except Exception as exc:
        logger.warning(
            "Failed to sync group users to project_members for group=%s project=%s: %s",
            group_id,
            body.project_id,
            exc,
        )

    return member


@router.delete("/{group_id}/members/{project_id}")
async def remove_group_member(group_id: str, project_id: str):
    """从项目组移除成员项目。"""
    existing = await project_group_service.get_group(group_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Project group not found")
    await project_group_service.remove_member(group_id, project_id)
    return {"ok": True}


# ── 聚合查询 ───────────────────────────────


@router.get("/{group_id}/conversations")
async def list_group_conversations(
    group_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """聚合项目组内所有项目的会话（按 tasks.session_id 聚合）。

    以到 ``cwd`` 为项目路径的任务为范围，按 ``session_id`` 聚合后返回
    列表，按最后活跃时间倒序。空组返回空列表。
    """
    await _ensure_group_exists(group_id)
    _, cwds = await _group_member_paths(group_id)
    if not cwds:
        return {"items": [], "total": 0, "limit": limit, "offset": offset}

    in_clause, params = _build_in_clause("cwd", cwds, "cwd_")
    async with async_session_factory() as session:
        total_row = await session.execute(
            text(
                f"""
                SELECT COUNT(DISTINCT session_id) FROM tasks
                WHERE session_id IS NOT NULL AND session_id != ''
                  AND {in_clause}
                """
            ),
            params,
        )
        total = int(total_row.scalar() or 0)

        page_params = dict(params)
        page_params["limit"] = limit
        page_params["offset"] = offset
        result = await session.execute(
            text(
                f"""
                SELECT session_id,
                       MAX(agent_id)   AS agent_id,
                       MAX(cwd)        AS cwd,
                       COUNT(*)        AS task_count,
                       MAX(status)     AS last_status,
                       MAX(created_at) AS last_active,
                       MIN(created_at) AS created_at
                FROM tasks
                WHERE session_id IS NOT NULL AND session_id != ''
                  AND {in_clause}
                GROUP BY session_id
                ORDER BY last_active DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            page_params,
        )
        rows = result.fetchall()

    items = [dict(row._mapping) for row in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{group_id}/tasks")
async def list_group_tasks(
    group_id: str,
    status: Optional[str] = Query(None, description="以状态过滤"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """聚合项目组内所有项目的任务。

    按 tasks.cwd 匹配组内项目路径，按 created_at 倒序返回。
    """
    await _ensure_group_exists(group_id)
    _, cwds = await _group_member_paths(group_id)
    if not cwds:
        return {"items": [], "total": 0, "limit": limit, "offset": offset}

    in_clause, params = _build_in_clause("cwd", cwds, "cwd_")
    extra = ""
    if status:
        extra = " AND status = :status"
        params["status"] = status

    async with async_session_factory() as session:
        total_row = await session.execute(
            text(f"SELECT COUNT(*) FROM tasks WHERE {in_clause}{extra}"),
            params,
        )
        total = int(total_row.scalar() or 0)

        page_params = dict(params)
        page_params["limit"] = limit
        page_params["offset"] = offset
        result = await session.execute(
            text(
                f"""
                SELECT id, workspace_id, plan_id, assignee_id, assignee_type,
                       chat_id, parent_task_id, prompt, cwd, model, agent_id,
                       session_id, status, result, attachments, output_path,
                       worktree_path, branch_name, diff_summary, test_result,
                       priority, labels, created_at, started_at, completed_at,
                       duration_ms
                FROM tasks
                WHERE {in_clause}{extra}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            page_params,
        )
        rows = result.fetchall()

    items = [dict(row._mapping) for row in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{group_id}/versions")
async def list_group_versions(
    group_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """聚合项目组内所有项目的版本（按 created_at 倒序）。"""
    await _ensure_group_exists(group_id)
    project_ids, _ = await _group_member_paths(group_id)
    if not project_ids:
        return {"items": [], "total": 0, "limit": limit, "offset": offset}

    in_clause, params = _build_in_clause("project_id", project_ids, "pid_")
    async with async_session_factory() as session:
        total_row = await session.execute(
            text(f"SELECT COUNT(*) FROM versions WHERE {in_clause}"),
            params,
        )
        total = int(total_row.scalar() or 0)

        page_params = dict(params)
        page_params["limit"] = limit
        page_params["offset"] = offset
        result = await session.execute(
            text(
                f"""
                SELECT id, project_id, name, description, status,
                       created_at, updated_at
                FROM versions
                WHERE {in_clause}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            page_params,
        )
        rows = result.fetchall()

    items = [dict(row._mapping) for row in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


# ── 项目组 Git 聚合 ────────────────────────────


@router.get("/{group_id}/git/branches")
async def list_group_branches(group_id: str):
    """聚合项目组内所有成员项目的 Git 分支（按项目分组）。"""
    await _ensure_group_exists(group_id)
    projects = await project_group_service.get_group_projects(group_id)
    results = []
    for p in projects:
        cwd = p.get("cwd")
        pid = p.get("project_id")
        name = p.get("name", pid)
        if not cwd or not Path(cwd).is_dir():
            continue
        try:
            code, output = await git_command(
                Path(cwd), ["branch", "--format=%(refname:short)"], timeout=10
            )
            branches = [b.strip() for b in output.splitlines() if b.strip()] if code == 0 else []
            code2, cur = await git_command(
                Path(cwd), ["rev-parse", "--abbrev-ref", "HEAD"], timeout=5
            )
            current = cur.strip() if code2 == 0 else None
            results.append({
                "project_id": pid,
                "name": name,
                "cwd": cwd,
                "branches": branches,
                "current": current,
            })
        except Exception as exc:
            logger.warning("list_group_branches: skip %s: %s", name, exc)
    return {"items": results}


@router.get("/{group_id}/git/commits")
async def list_group_commits(
    group_id: str,
    since: Optional[str] = Query(None, description="起始时间 (ISO 格式)"),
    until: Optional[str] = Query(None, description="截止时间 (ISO 格式)"),
    limit: int = Query(50, ge=1, le=200, description="最大返回条数"),
):
    """聚合项目组内所有成员项目的 Git 提交（按时间倒序）。"""
    await _ensure_group_exists(group_id)
    projects = await project_group_service.get_group_projects(group_id)
    all_commits = []
    for p in projects:
        cwd = p.get("cwd")
        pid = p.get("project_id")
        name = p.get("name", pid)
        if not cwd or not Path(cwd).is_dir():
            continue
        try:
            code, output = await git_log_files(
                cwd=cwd, branch=None, limit=limit, since=since, until=until
            )
            if code == 0 and output.strip():
                commits = _parse_log_output(output)
                for c in commits:
                    c["project_id"] = pid
                    c["project_name"] = name
                all_commits.extend(commits)
        except Exception as exc:
            logger.warning("list_group_commits: skip %s: %s", name, exc)
    # 按 date 倒序排序，取 limit 条
    all_commits.sort(key=lambda c: c.get("date", ""), reverse=True)
    all_commits = all_commits[:limit]
    return {"commits": all_commits, "total": len(all_commits)}


@router.get("/{group_id}/git/changes")
async def list_group_changes(
    group_id: str,
    group_by: str = Query("branch", description="聚合维度: work_item | session | branch | version"),
    since: Optional[str] = Query(None, description="起始时间"),
    until: Optional[str] = Query(None, description="截止时间"),
):
    """聚合项目组内所有成员项目的 Git 变更统计（按项目分组）。"""
    await _ensure_group_exists(group_id)
    if group_by not in ("work_item", "session", "branch", "version"):
        raise HTTPException(status_code=400, detail="group_by 必须为 work_item / session / branch / version")

    projects = await project_group_service.get_group_projects(group_id)
    result_projects = []
    for p in projects:
        cwd = p.get("cwd")
        pid = p.get("project_id")
        name = p.get("name", pid)
        if not cwd or not Path(cwd).is_dir():
            continue
        try:
            if group_by == "work_item":
                changes = await _group_by_work_item(pid, cwd, since, until)
            elif group_by == "session":
                changes = await _group_by_session(pid, cwd, since, until, None)
            elif group_by == "version":
                changes = await _group_by_version(pid, cwd, since, until)
            else:
                changes = await _group_by_branch(cwd, since, until)
            result_projects.append({
                "project_id": pid,
                "name": name,
                "changes": changes,
            })
        except Exception as exc:
            logger.warning("list_group_changes: skip %s: %s", name, exc)
    return {"projects": result_projects, "group_by": group_by}


@router.get("/{group_id}/git/diff/{project_id}/{commit_hash}")
async def get_group_commit_diff(
    group_id: str,
    project_id: str,
    commit_hash: str,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """获取项目组内某个成员项目的 commit diff。"""
    await _ensure_group_exists(group_id)

    # 验证 project_id 属于该项目组
    projects = await project_group_service.get_group_projects(group_id)
    matched = next((p for p in projects if p.get("project_id") == project_id), None)
    if not matched:
        raise HTTPException(status_code=404, detail="该项目不属于此项目组")

    cwd = matched.get("cwd")
    if not cwd or not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 验证 commit hash 格式
    if not re.match(r"^[0-9a-fA-F]{7,40}$", commit_hash):
        raise HTTPException(status_code=400, detail="无效的 commit hash 格式")

    # git show --format= 只显示 diff
    code, output = await git_command(
        Path(cwd), ["show", "--format=", commit_hash], timeout=30
    )
    if code != 0:
        raise HTTPException(status_code=404, detail=f"获取 commit diff 失败: {output[:300]}")

    return PlainTextResponse(output)


# ── 工作流绑定 ────────────────────────────


async def _read_group_workflow(group_id: str) -> tuple[Optional[str], Optional[str]]:
    """读取项目组绑定的 (workflow_id, flow_mode)。"""
    async with async_session_factory() as session:
        row = (
            await session.execute(
                text("SELECT workflow_id, flow_mode FROM project_groups WHERE id = :id"),
                {"id": group_id},
            )
        ).fetchone()
    if not row:
        return None, None
    return row[0], row[1]


@router.get("/{group_id}/workflow")
async def get_group_workflow(group_id: str):
    """查询项目组绑定的工作流。返回绑定信息、工作流名称及协作模式。"""
    await _ensure_group_exists(group_id)
    workflow_id, flow_mode = await _read_group_workflow(group_id)
    workflow_name: Optional[str] = None
    if workflow_id:
        wf = await workflow_service.get_workflow(workflow_id)
        if wf:
            workflow_name = wf.get("name")
        else:
            # 被删除的工作流：保留 id 但名称为空，供前端提示
            workflow_name = None
    return {
        "group_id": group_id,
        "workflow_id": workflow_id,
        "workflow_name": workflow_name,
        "flow_mode": flow_mode,
    }


@router.put("/{group_id}/workflow")
async def set_group_workflow(group_id: str, body: dict):
    """设置项目组绑定的工作流 / 协作模式。

    body: ``{"workflow_id": "xxx", "flow_mode": "freeform"}``。
    - flow_mode 可选，传 None 时保留现有值（向后兼容）；
    - flow_mode='freeform' 时 workflow_id 可选；其余模式仍要求 workflow_id。
    """
    await _ensure_group_exists(group_id)
    body = body or {}

    flow_mode = body.get("flow_mode")
    valid_modes = {"default_workflow", "custom_workflow", "freeform"}
    if flow_mode is not None and flow_mode not in valid_modes:
        raise HTTPException(status_code=400, detail=f"invalid flow_mode: {flow_mode}")

    workflow_id = body.get("workflow_id")
    workflow_id = (
        str(workflow_id).strip() if workflow_id and str(workflow_id).strip() else None
    )

    # freeform 无需绑定工作流；其余模式仍要求 workflow_id
    if flow_mode != "freeform" and not workflow_id:
        raise HTTPException(status_code=400, detail="workflow_id is required")

    wf = None
    if workflow_id:
        wf = await workflow_service.get_workflow(workflow_id)
        if not wf:
            raise HTTPException(status_code=404, detail="Workflow not found")

    async with async_session_factory() as session:
        if flow_mode is not None:
            await session.execute(
                text(
                    "UPDATE project_groups SET workflow_id = :wf_id, flow_mode = :flow_mode,"
                    " updated_at = CURRENT_TIMESTAMP WHERE id = :id"
                ),
                {"wf_id": workflow_id, "flow_mode": flow_mode, "id": group_id},
            )
        else:
            await session.execute(
                text(
                    "UPDATE project_groups SET workflow_id = :wf_id,"
                    " updated_at = CURRENT_TIMESTAMP WHERE id = :id"
                ),
                {"wf_id": workflow_id, "id": group_id},
            )
        await session.commit()

    _, current_flow_mode = await _read_group_workflow(group_id)
    return {
        "group_id": group_id,
        "workflow_id": workflow_id,
        "workflow_name": wf.get("name") if wf else None,
        "flow_mode": current_flow_mode,
    }


@router.delete("/{group_id}/workflow")
async def unset_group_workflow(group_id: str):
    """解除项目组的工作流绑定。"""
    await _ensure_group_exists(group_id)
    async with async_session_factory() as session:
        await session.execute(
            text(
                "UPDATE project_groups SET workflow_id = NULL, updated_at = CURRENT_TIMESTAMP"
                " WHERE id = :id"
            ),
            {"id": group_id},
        )
        await session.commit()
    return {"ok": True, "group_id": group_id, "workflow_id": None}


# ── 项目组用户成员 ──────────────────────────────────────────────


@router.get("/{group_id}/users")
async def list_group_user_members(
    group_id: str,
    current_user: Optional[dict] = Depends(get_optional_user),
) -> dict:
    """列出项目组用户成员（JOIN users 返回用户信息）。"""
    await _ensure_group_exists(group_id)

    async with async_session_factory() as session:
        await _ensure_can_view_group_users(session, group_id, current_user)

        result = await session.execute(
            text(
                "SELECT m.id AS member_id, m.role AS group_role,"
                " m.created_at AS joined_at,"
                " u.id, u.username, u.email, u.display_name, u.avatar_url,"
                " u.role AS global_role, u.status, u.lark_open_id"
                " FROM project_group_user_members m"
                " JOIN users u ON u.id = m.user_id"
                " WHERE m.group_id = :gid"
                " ORDER BY m.created_at ASC"
            ),
            {"gid": group_id},
        )
        members = [dict(r._mapping) for r in result.fetchall()]

    return {"members": members, "total": len(members)}


@router.get("/{group_id}/users/available")
async def list_available_group_users(
    group_id: str,
    q: Optional[str] = Query(None, description="搜索关键词(username/email/display_name)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Optional[dict] = Depends(get_optional_user),
) -> dict:
    """列出可添加为项目组用户成员的用户（排除已是该组成员的用户）。

    权限：项目组 owner 或全局 admin 可调用。
    """
    await _ensure_group_exists(group_id)

    async with async_session_factory() as session:
        await _ensure_can_manage_group_users(session, group_id, current_user)

        # 获取已有成员的 user_id
        existing = await session.execute(
            text("SELECT user_id FROM project_group_user_members WHERE group_id = :gid"),
            {"gid": group_id},
        )
        existing_ids = {row[0] for row in existing.fetchall()}

        # 查询用户表，支持搜索
        base_query = "SELECT id, username, email, display_name, role FROM users WHERE 1=1"
        params: dict = {}

        if q:
            base_query += " AND (username LIKE :q OR email LIKE :q OR display_name LIKE :q)"
            params["q"] = f"%{q}%"

        base_query += " ORDER BY username ASC"
        result = await session.execute(text(base_query), params)

        # 排除已有成员并分页
        all_users = []
        for row in result.fetchall():
            if row[0] not in existing_ids:
                all_users.append({
                    "id": row[0],
                    "username": row[1],
                    "email": row[2],
                    "display_name": row[3],
                    "role": row[4],
                })

        total = len(all_users)
        offset = (page - 1) * page_size
        items = all_users[offset : offset + page_size]

    return {"items": items, "total": total}


@router.post("/{group_id}/users", status_code=status.HTTP_201_CREATED)
async def add_group_user_member(
    group_id: str,
    body: dict,
    current_user: Optional[dict] = Depends(get_optional_user),
) -> dict:
    """添加用户成员。body: ``{user_id: str, role?: str}``。"""
    await _ensure_group_exists(group_id)

    user_id = (body or {}).get("user_id")
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=400, detail="user_id is required")
    user_id = str(user_id).strip()
    role = _validate_group_user_role((body or {}).get("role"))

    async with async_session_factory() as session:
        await _ensure_can_manage_group_users(session, group_id, current_user)

        # 用户存在性检查
        user_row = await session.execute(
            text(
                "SELECT id, username, email, display_name, avatar_url,"
                " role, status FROM users WHERE id = :uid"
            ),
            {"uid": user_id},
        )
        user = user_row.fetchone()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        # 重复成员检查
        existing = await session.execute(
            text(
                "SELECT id FROM project_group_user_members"
                " WHERE group_id = :gid AND user_id = :uid LIMIT 1"
            ),
            {"gid": group_id, "uid": user_id},
        )
        if existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already a member of this project group",
            )

        member_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        await session.execute(
            text(
                "INSERT INTO project_group_user_members"
                " (id, group_id, user_id, role, created_at)"
                " VALUES (:id, :gid, :uid, :role, :now)"
            ),
            {
                "id": member_id,
                "gid": group_id,
                "uid": user_id,
                "role": role,
                "now": now,
            },
        )
        await session.commit()

        # 同步新用户到组内所有成员项目的 project_members
        try:
            group_projects = await session.execute(
                text(
                    "SELECT project_id FROM project_group_members"
                    " WHERE group_id = :group_id"
                ),
                {"group_id": group_id},
            )
            for row in group_projects.fetchall():
                project_id = row[0]
                await session.execute(
                    text(
                        "INSERT OR IGNORE INTO project_members"
                        " (id, project_id, user_id, role)"
                        " VALUES (:id, :project_id, :user_id, :role)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "project_id": project_id,
                        "user_id": user_id,
                        "role": role,
                    },
                )
            await session.commit()
        except Exception as exc:
            logger.warning(
                "Failed to sync group user %s to project_members for group %s: %s",
                user_id,
                group_id,
                exc,
            )

    logger.info(
        "user %s added group-member %s to group %s as %s",
        (current_user or {}).get("id"),
        user_id,
        group_id,
        role,
    )
    return {
        "member_id": member_id,
        "group_id": group_id,
        "user_id": user_id,
        "role": role,
        "joined_at": now,
        "user": dict(user._mapping),
    }


@router.put("/{group_id}/users/{user_id}")
async def update_group_user_member(
    group_id: str,
    user_id: str,
    body: dict,
    current_user: Optional[dict] = Depends(get_optional_user),
) -> dict:
    """修改用户成员角色。body: ``{role: str}``。"""
    await _ensure_group_exists(group_id)

    role_in = (body or {}).get("role")
    if role_in is None:
        raise HTTPException(status_code=400, detail="role is required")
    role = _validate_group_user_role(role_in)

    async with async_session_factory() as session:
        await _ensure_can_manage_group_users(session, group_id, current_user)

        existing = await session.execute(
            text(
                "SELECT id FROM project_group_user_members"
                " WHERE group_id = :gid AND user_id = :uid LIMIT 1"
            ),
            {"gid": group_id, "uid": user_id},
        )
        if not existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found in this project group",
            )

        await session.execute(
            text(
                "UPDATE project_group_user_members SET role = :role"
                " WHERE group_id = :gid AND user_id = :uid"
            ),
            {"role": role, "gid": group_id, "uid": user_id},
        )
        await session.commit()

    logger.info(
        "user %s updated group-member %s in group %s -> %s",
        (current_user or {}).get("id"),
        user_id,
        group_id,
        role,
    )
    return {"group_id": group_id, "user_id": user_id, "role": role}


@router.delete("/{group_id}/users/{user_id}")
async def remove_group_user_member(
    group_id: str,
    user_id: str,
    current_user: Optional[dict] = Depends(get_optional_user),
) -> dict:
    """从项目组中移除用户成员。"""
    await _ensure_group_exists(group_id)

    async with async_session_factory() as session:
        await _ensure_can_manage_group_users(session, group_id, current_user)

        existing = await session.execute(
            text(
                "SELECT id FROM project_group_user_members"
                " WHERE group_id = :gid AND user_id = :uid LIMIT 1"
            ),
            {"gid": group_id, "uid": user_id},
        )
        if not existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found in this project group",
            )

        await session.execute(
            text(
                "DELETE FROM project_group_user_members"
                " WHERE group_id = :gid AND user_id = :uid"
            ),
            {"gid": group_id, "uid": user_id},
        )
        await session.commit()

    logger.info(
        "user %s removed group-member %s from group %s",
        (current_user or {}).get("id"),
        user_id,
        group_id,
    )
    return {"ok": True}
