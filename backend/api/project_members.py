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
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
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


class UpdateMemberRequest(BaseModel):
    role: str = Field(..., min_length=1)


# ── 工具函数 ──────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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
    if project_role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project admin or global admin can manage members",
        )


# ── 路由 ──────────────────────────────────────────────────


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
