"""项目成员管理 API。

权限模型：
- 全局 admin（users.role = 'admin'）：可对任意项目成员进行任何操作
- 项目 admin（project_members.role = 'admin'）：可管理本项目成员
- 项目 member/viewer：仅可查看本项目成员
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from backend.core.dependencies import get_current_user
from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.api.project_members")

router = APIRouter(
    prefix="/api/projects/{project_id}/members",
    tags=["project-members"],
)


_VALID_PROJECT_ROLES = {"admin", "member", "viewer"}


# ── 请求模型 ──────────────────────────────────────────────


class AddMemberRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    role: Optional[str] = Field(default="member")


class BatchAddMembersRequest(BaseModel):
    user_ids: List[str]
    role: str = "member"


class UpdateMemberRequest(BaseModel):
    role: str = Field(..., min_length=1)


# ── 工具函数 ──────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _project_display_name(project_id: str) -> str:
    """将编码后的 project_id 解码为友好名称（取路径末段）。"""
    import base64
    import binascii

    s = project_id or ""
    pad = "=" * (-len(s) % 4)
    try:
        decoded = base64.urlsafe_b64decode((s + pad).encode()).decode("utf-8")
        if decoded:
            return decoded.rstrip("/").split("/")[-1] or decoded
    except (binascii.Error, UnicodeDecodeError, ValueError):
        pass
    return project_id


def _validate_role(role: Optional[str]) -> str:
    if role is None:
        return "member"
    if role not in _VALID_PROJECT_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role: {role}. Must be one of {sorted(_VALID_PROJECT_ROLES)}",
        )
    return role


def _is_global_admin(user: dict) -> bool:
    return (user or {}).get("role") == "admin"


async def _get_project_role(session, project_id: str, user_id: str) -> Optional[str]:
    result = await session.execute(
        text(
            "SELECT role FROM project_members"
            " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
        ),
        {"pid": project_id, "uid": user_id},
    )
    row = result.fetchone()
    return row[0] if row else None


async def _ensure_can_view(
    session, project_id: str, current_user: Optional[dict]
) -> None:
    if not current_user:
        # 未启用强制认证，允许查看
        return
    if _is_global_admin(current_user):
        return
    project_role = await _get_project_role(session, project_id, current_user["id"])
    if project_role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this project",
        )


async def _ensure_can_manage(
    session, project_id: str, current_user: Optional[dict]
) -> None:
    if not current_user:
        return
    if _is_global_admin(current_user):
        return
    project_role = await _get_project_role(session, project_id, current_user["id"])
    if project_role not in ("admin", "owner"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project admin/owner or global admin can manage members",
        )


# ── 路由 ──────────────────────────────────────────────────


@router.get("/available")
async def list_available_users(
    project_id: str,
    q: Optional[str] = Query(None, description="搜索关键词(username/email/display_name)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """列出可添加为项目成员的用户（未加入该项目的系统用户）。

    权限：项目 admin 或全局 admin 可调用。
    """
    async with async_session_factory() as session:
        await _ensure_can_manage(session, project_id, current_user)

        # 获取已有成员的 user_id
        existing = await session.execute(
            text("SELECT user_id FROM project_members WHERE project_id = :pid"),
            {"pid": project_id},
        )
        existing_ids = {row[0] for row in existing.fetchall()}

        # 查询用户表，支持搜索
        base_query = "SELECT id, username, email, display_name, role FROM users WHERE 1=1"
        params: dict = {}

        if q:
            base_query += (
                " AND (username LIKE :q OR email LIKE :q OR display_name LIKE :q)"
            )
            params["q"] = f"%{q}%"

        base_query += " ORDER BY username ASC"
        result = await session.execute(text(base_query), params)

        # 在 Python 端排除已有成员并分页
        all_users = []
        for row in result.fetchall():
            if row[0] not in existing_ids:
                all_users.append(
                    {
                        "id": row[0],
                        "username": row[1],
                        "email": row[2],
                        "display_name": row[3],
                        "role": row[4],
                    }
                )

        total = len(all_users)
        offset = (page - 1) * page_size
        items = all_users[offset : offset + page_size]

    return {"items": items, "total": total}


@router.post("/batch", status_code=status.HTTP_201_CREATED)
async def batch_add_members(
    project_id: str,
    body: BatchAddMembersRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """批量添加项目成员。"""
    role = _validate_role(body.role)

    async with async_session_factory() as session:
        await _ensure_can_manage(session, project_id, current_user)

        added = []
        skipped = []
        for user_id in body.user_ids:
            # 检查用户存在
            user = await session.execute(
                text("SELECT id, username FROM users WHERE id = :uid"),
                {"uid": user_id},
            )
            row = user.fetchone()
            if not row:
                skipped.append({"user_id": user_id, "reason": "用户不存在"})
                continue

            # 检查是否已是成员
            existing = await session.execute(
                text(
                    "SELECT 1 FROM project_members"
                    " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
                ),
                {"pid": project_id, "uid": user_id},
            )
            if existing.fetchone():
                skipped.append({"user_id": user_id, "reason": "已是项目成员"})
                continue

            member_id = str(uuid.uuid4())
            now = _now_iso()
            await session.execute(
                text(
                    "INSERT INTO project_members (id, project_id, user_id, role, created_at)"
                    " VALUES (:id, :pid, :uid, :role, :now)"
                ),
                {
                    "id": member_id,
                    "pid": project_id,
                    "uid": user_id,
                    "role": role,
                    "now": now,
                },
            )
            added.append(user_id)

        await session.commit()

    logger.info(
        "user %s batch-added %d members to project %s (skipped %d)",
        current_user.get("id") if current_user else None,
        len(added),
        project_id,
        len(skipped),
    )

    # 用户被添加为项目成员 → 通知每个新成员（不通知自己）
    try:
        from backend.services.notification_service import notification_service

        actor_id = current_user.get("id") if current_user else None
        proj_name = _project_display_name(project_id)
        for uid in added:
            if uid and uid != actor_id:
                await notification_service.create_notification(
                    recipient_id=uid,
                    work_item_id=project_id,
                    notification_type="project_added",
                    trigger_actor_id=actor_id,
                    content=f"您已被添加到项目「{proj_name}」",
                )
    except Exception:
        logger.debug("create project_added notification failed", exc_info=True)

    return {"added": added, "skipped": skipped}


@router.get("")
async def list_members(
    project_id: str,
    current_user: Optional[dict] = Depends(get_current_user),
) -> dict:
    """列出项目成员（含用户信息 + 项目角色）。"""
    async with async_session_factory() as session:
        await _ensure_can_view(session, project_id, current_user)

        result = await session.execute(
            text(
                "SELECT pm.id AS member_id, pm.role AS project_role,"
                " pm.created_at AS joined_at,"
                " u.id, u.username, u.email, u.display_name, u.avatar_url,"
                " u.role AS global_role, u.status, u.lark_open_id"
                " FROM project_members pm"
                " JOIN users u ON u.id = pm.user_id"
                " WHERE pm.project_id = :pid"
                " ORDER BY pm.created_at ASC"
            ),
            {"pid": project_id},
        )
        members = [dict(r._mapping) for r in result.fetchall()]

    return {"members": members, "total": len(members)}


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_member(
    project_id: str,
    body: AddMemberRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """添加项目成员。"""
    role = _validate_role(body.role)

    async with async_session_factory() as session:
        await _ensure_can_manage(session, project_id, current_user)

        # 用户存在性检查
        user_row = await session.execute(
            text(
                "SELECT id, username, email, display_name, avatar_url,"
                " role, status FROM users WHERE id = :uid"
            ),
            {"uid": body.user_id},
        )
        user = user_row.fetchone()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        # 重复检查
        existing = await session.execute(
            text(
                "SELECT id FROM project_members"
                " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
            ),
            {"pid": project_id, "uid": body.user_id},
        )
        if existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already a member of this project",
            )

        member_id = str(uuid.uuid4())
        now = _now_iso()
        await session.execute(
            text(
                "INSERT INTO project_members (id, project_id, user_id, role, created_at)"
                " VALUES (:id, :pid, :uid, :role, :now)"
            ),
            {
                "id": member_id,
                "pid": project_id,
                "uid": body.user_id,
                "role": role,
                "now": now,
            },
        )
        await session.commit()

    logger.info(
        "user %s added member %s to project %s as %s",
        current_user.get("id") if current_user else None,
        body.user_id,
        project_id,
        role,
    )

    # 用户被添加为项目成员 → 通知该用户（不通知自己）
    try:
        from backend.services.notification_service import notification_service

        actor_id = current_user.get("id") if current_user else None
        if body.user_id and body.user_id != actor_id:
            await notification_service.create_notification(
                recipient_id=body.user_id,
                work_item_id=project_id,
                notification_type="project_added",
                trigger_actor_id=actor_id,
                content=f"您已被添加到项目「{_project_display_name(project_id)}」",
            )
    except Exception:
        logger.debug("create project_added notification failed", exc_info=True)

    return {
        "member_id": member_id,
        "project_id": project_id,
        "user_id": body.user_id,
        "role": role,
        "joined_at": now,
        "user": dict(user._mapping),
    }


@router.put("/{user_id}")
async def update_member_role(
    project_id: str,
    user_id: str,
    body: UpdateMemberRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """修改项目成员角色。"""
    role = _validate_role(body.role)

    async with async_session_factory() as session:
        await _ensure_can_manage(session, project_id, current_user)

        existing = await session.execute(
            text(
                "SELECT id FROM project_members"
                " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
            ),
            {"pid": project_id, "uid": user_id},
        )
        if not existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found in this project",
            )

        await session.execute(
            text(
                "UPDATE project_members SET role = :role"
                " WHERE project_id = :pid AND user_id = :uid"
            ),
            {"role": role, "pid": project_id, "uid": user_id},
        )
        await session.commit()

    logger.info(
        "user %s updated member %s in project %s -> %s",
        current_user.get("id") if current_user else None,
        user_id,
        project_id,
        role,
    )
    return {
        "project_id": project_id,
        "user_id": user_id,
        "role": role,
    }


@router.delete("/{user_id}")
async def remove_member(
    project_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """从项目中移除成员。"""
    async with async_session_factory() as session:
        await _ensure_can_manage(session, project_id, current_user)

        existing = await session.execute(
            text(
                "SELECT id FROM project_members"
                " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
            ),
            {"pid": project_id, "uid": user_id},
        )
        if not existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found in this project",
            )

        await session.execute(
            text(
                "DELETE FROM project_members"
                " WHERE project_id = :pid AND user_id = :uid"
            ),
            {"pid": project_id, "uid": user_id},
        )
        await session.commit()

    logger.info(
        "user %s removed member %s from project %s",
        current_user.get("id") if current_user else None,
        user_id,
        project_id,
    )
    return {"ok": True}
