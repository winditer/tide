"""管理员后台 API：用户的增删改查与密码重置。

所有端点均需要 admin 角色（通过 require_role("admin") 依赖保护）。
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from backend.core.dependencies import get_current_user, require_role
from backend.core.security import hash_password
from backend.db.engine import async_session_factory
from backend.runtime.config import TIDE_PASSWORD_MIN_LENGTH
from backend.services.auth_service import auth_service

logger = logging.getLogger("tide.api.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ── 请求/响应模型 ─────────────────────────────────────────


_VALID_ROLES = {"admin", "member", "viewer"}


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1)
    email: Optional[str] = None
    role: Optional[str] = Field(default="member")
    display_name: Optional[str] = None


class UserUpdateRequest(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
    display_name: Optional[str] = None
    status: Optional[str] = None  # active | disabled


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=1)


# ── 工具函数 ──────────────────────────────────────────────


_USER_PUBLIC_COLUMNS = (
    "id, username, email, display_name, avatar_url, role, status,"
    " lark_open_id, lark_union_id, workspace_id,"
    " last_login_at, created_at, updated_at"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _validate_role(role: Optional[str]) -> str:
    if role is None:
        return "member"
    if role not in _VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role: {role}. Must be one of {sorted(_VALID_ROLES)}",
        )
    return role


def _validate_status(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if value not in {"active", "disabled"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid status. Must be 'active' or 'disabled'",
        )
    return value


def _row_to_user(row) -> dict:
    return dict(row._mapping)


# ── 路由 ──────────────────────────────────────────────────


@router.get("/users")
async def list_users(
    q: Optional[str] = Query(default=None, description="搜索关键词（username/email/display_name）"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    current_user: dict = Depends(require_role("admin")),
) -> dict:
    """列出所有用户，支持搜索 + 分页。"""
    offset = (page - 1) * page_size
    where_sql = ""
    params: dict = {"limit": page_size, "offset": offset}
    if q:
        where_sql = (
            " WHERE username LIKE :kw OR email LIKE :kw"
            " OR display_name LIKE :kw"
        )
        params["kw"] = f"%{q}%"

    async with async_session_factory() as session:
        total_row = await session.execute(
            text(f"SELECT COUNT(*) FROM users{where_sql}"),
            params,
        )
        total = int(total_row.scalar() or 0)

        rows = await session.execute(
            text(
                f"SELECT {_USER_PUBLIC_COLUMNS} FROM users{where_sql}"
                " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        )
        users = [_row_to_user(r) for r in rows.fetchall()]

    return {
        "users": users,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreateRequest,
    current_user: dict = Depends(require_role("admin")),
) -> dict:
    """创建新用户。"""
    if len(body.password) < TIDE_PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at least {TIDE_PASSWORD_MIN_LENGTH} characters",
        )

    role = _validate_role(body.role)
    user_id = str(uuid.uuid4())
    now = _now_iso()

    async with async_session_factory() as session:
        # 重复检查
        dup = await session.execute(
            text(
                "SELECT id FROM users"
                " WHERE username = :username"
                "    OR (email IS NOT NULL AND email = :email)"
                " LIMIT 1"
            ),
            {"username": body.username, "email": body.email},
        )
        if dup.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username or email already exists",
            )

        await session.execute(
            text(
                "INSERT INTO users"
                " (id, username, email, password_hash, display_name,"
                "  role, status, workspace_id, created_at, updated_at)"
                " VALUES (:id, :username, :email, :password_hash, :display_name,"
                "  :role, 'active', 'default', :now, :now)"
            ),
            {
                "id": user_id,
                "username": body.username,
                "email": body.email,
                "password_hash": hash_password(body.password),
                "display_name": body.display_name or body.username,
                "role": role,
                "now": now,
            },
        )
        await session.commit()

        row = await session.execute(
            text(f"SELECT {_USER_PUBLIC_COLUMNS} FROM users WHERE id = :id"),
            {"id": user_id},
        )
        created = row.fetchone()

    if not created:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create user",
        )
    logger.info("admin %s created user %s", current_user.get("id"), user_id)
    return _row_to_user(created)


@router.get("/users/{user_id}")
async def get_user(
    user_id: str,
    current_user: dict = Depends(require_role("admin")),
) -> dict:
    """获取单个用户详情。"""
    async with async_session_factory() as session:
        row = await session.execute(
            text(f"SELECT {_USER_PUBLIC_COLUMNS} FROM users WHERE id = :id"),
            {"id": user_id},
        )
        result = row.fetchone()
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return _row_to_user(result)


@router.put("/users/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdateRequest,
    current_user: dict = Depends(require_role("admin")),
) -> dict:
    """更新用户信息（不允许修改自己的 role/status，避免锁死）。"""
    sets: list[str] = []
    params: dict = {"id": user_id, "now": _now_iso()}

    if body.email is not None:
        sets.append("email = :email")
        params["email"] = body.email

    if body.display_name is not None:
        sets.append("display_name = :display_name")
        params["display_name"] = body.display_name

    if body.role is not None:
        if current_user and current_user.get("id") == user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change your own role",
            )
        params["role"] = _validate_role(body.role)
        sets.append("role = :role")

    if body.status is not None:
        if current_user and current_user.get("id") == user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change your own status",
            )
        params["status"] = _validate_status(body.status)
        sets.append("status = :status")

    if not sets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    async with async_session_factory() as session:
        existing = await session.execute(
            text("SELECT id FROM users WHERE id = :id"),
            {"id": user_id},
        )
        if not existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        # email 唯一性检查
        if body.email is not None:
            dup = await session.execute(
                text(
                    "SELECT id FROM users WHERE email = :email AND id != :id LIMIT 1"
                ),
                {"email": body.email, "id": user_id},
            )
            if dup.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Email already in use",
                )

        await session.execute(
            text(
                f"UPDATE users SET {', '.join(sets)}, updated_at = :now"
                " WHERE id = :id"
            ),
            params,
        )
        await session.commit()

        # 如果用户被禁用，吊销其会话
        if body.status == "disabled":
            await session.execute(
                text(
                    "UPDATE user_sessions SET is_active = 0, last_used_at = :now"
                    " WHERE user_id = :id"
                ),
                {"id": user_id, "now": _now_iso()},
            )
            await session.commit()

        row = await session.execute(
            text(f"SELECT {_USER_PUBLIC_COLUMNS} FROM users WHERE id = :id"),
            {"id": user_id},
        )
        updated = row.fetchone()

    logger.info("admin %s updated user %s", current_user.get("id") if current_user else None, user_id)
    return _row_to_user(updated)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: dict = Depends(require_role("admin")),
) -> dict:
    """删除用户（级联清理 user_sessions / project_members）。"""
    if current_user and current_user.get("id") == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself",
        )

    async with async_session_factory() as session:
        existing = await session.execute(
            text("SELECT id FROM users WHERE id = :id"),
            {"id": user_id},
        )
        if not existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        await session.execute(
            text("DELETE FROM user_sessions WHERE user_id = :id"),
            {"id": user_id},
        )
        await session.execute(
            text("DELETE FROM project_members WHERE user_id = :id"),
            {"id": user_id},
        )
        await session.execute(
            text("DELETE FROM users WHERE id = :id"),
            {"id": user_id},
        )
        await session.commit()

    logger.info("admin %s deleted user %s", current_user.get("id") if current_user else None, user_id)
    return {"ok": True}


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    body: ResetPasswordRequest,
    current_user: dict = Depends(require_role("admin")),
) -> dict:
    """重置用户密码并吊销该用户全部活跃会话。"""
    if len(body.new_password) < TIDE_PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at least {TIDE_PASSWORD_MIN_LENGTH} characters",
        )

    async with async_session_factory() as session:
        existing = await session.execute(
            text("SELECT id FROM users WHERE id = :id"),
            {"id": user_id},
        )
        if not existing.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        await session.execute(
            text(
                "UPDATE users SET password_hash = :hash, updated_at = :now"
                " WHERE id = :id"
            ),
            {
                "hash": hash_password(body.new_password),
                "now": _now_iso(),
                "id": user_id,
            },
        )
        await session.commit()

    # 吊销该用户所有活跃会话
    await auth_service.revoke_session(user_id=user_id)

    logger.info(
        "admin %s reset password for user %s",
        current_user.get("id") if current_user else None,
        user_id,
    )
    return {"ok": True}


@router.get("/users/{user_id}/projects")
async def list_user_projects(
    user_id: str,
    current_user: dict = Depends(require_role("admin")),
) -> dict:
    """查看用户可访问的项目列表（admin 用户返回 ['*']）。"""
    async with async_session_factory() as session:
        existing = await session.execute(
            text("SELECT id, role FROM users WHERE id = :id"),
            {"id": user_id},
        )
        row = existing.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        if (row[1] or "") == "admin":
            return {"projects": ["*"], "is_admin": True}

        result = await session.execute(
            text(
                "SELECT project_id, role, created_at FROM project_members"
                " WHERE user_id = :id ORDER BY created_at DESC"
            ),
            {"id": user_id},
        )
        items = [dict(r._mapping) for r in result.fetchall()]

    return {"projects": items, "is_admin": False}
