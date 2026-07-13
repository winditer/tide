"""FastAPI 认证依赖注入。

提供：
- get_current_user：强制认证，无效 token 抛 401
- get_optional_user：可选认证（受 TIDE_REQUIRE_AUTH 控制）
- require_role：基于角色等级的访问控制依赖工厂
"""

from __future__ import annotations

import base64
from typing import Callable, Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import text

from backend.core.security import verify_token
from backend.db.engine import async_session_factory
from backend.runtime.config import TIDE_REQUIRE_AUTH


ROLE_HIERARCHY = {"viewer": 0, "member": 1, "admin": 2}


def encode_project_id(cwd: str) -> str:
    """与 backend/api/projects.py 中 ``_encode_id`` 保持一致。"""
    if not cwd:
        return ""
    return base64.urlsafe_b64encode(cwd.encode()).decode().rstrip("=")


async def get_accessible_project_ids(
    current_user: Optional[dict],
) -> Optional[set[str]]:
    """返回当前用户可访问的 project_id 集合。

    返回值：
    - ``None``：表示不限制（未登录或 admin 用户）。
    - ``set[str]``：当前用户具有访问权限的 project_id 集合。
    """
    if not current_user:
        return None
    if current_user.get("role") == "admin":
        return None
    from backend.services.auth_service import auth_service

    accessible = await auth_service.get_user_accessible_projects(
        current_user["id"]
    )
    if "*" in accessible:
        return None
    return set(accessible)


async def check_project_write_permission(
    project_id: Optional[str],
    current_user: Optional[dict],
) -> None:
    """检查用户对指定项目是否有写权限。viewer 角色会被拒绝。

    入参：
    - ``project_id``：项目 ID（base64 编码的 cwd）。空值表示无法确定项目归属，直接放行。
    - ``current_user``：当前用户。``None`` 表示未启用强制认证，直接放行。

    放行规则：
    1. 未登录（未启用 TIDE_REQUIRE_AUTH）→ 放行；
    2. 全局 admin（users.role == 'admin'）→ 放行；
    3. 项目无成员记录（如未配置成员管理）→ 放行；
    4. 项目角色不是 viewer → 放行。

    拒绝规则：当用户在 ``project_members`` 中的角色为 viewer 时抛 403。
    """
    if not current_user:
        return
    if current_user.get("role") == "admin":
        return
    if not project_id:
        return
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT role FROM project_members"
                " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
            ),
            {"pid": project_id, "uid": current_user["id"]},
        )
        row = result.fetchone()
    if row and row[0] == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewer role has read-only access",
        )


async def check_project_write_permission_with_group(
    project_id: Optional[str],
    current_user: Optional[dict],
) -> None:
    """检查用户对指定项目是否有写权限（含项目组兜底）。

    在 ``check_project_write_permission`` 基础上，增加项目组admin/owner/member兜底：
    当用户在项目级角色为 viewer 被拒绝时，若该用户在包含此项目的任一项目组中
    拥有 owner 或 member 角色，则仍然放行。
    """
    if not current_user:
        return
    if current_user.get("role") == "admin":
        return
    if not project_id:
        return

    # 先查项目级角色
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT role FROM project_members"
                " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
            ),
            {"pid": project_id, "uid": current_user["id"]},
        )
        row = result.fetchone()

    # 非 viewer 或无记录 → 放行
    if not row or row[0] != "viewer":
        return

    # viewer 被拒绝前，检查项目组兜底
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT pgum.role FROM project_group_user_members pgum"
                " JOIN project_group_members pgm ON pgm.group_id = pgum.group_id"
                " WHERE pgm.project_id = :pid AND pgum.user_id = :uid"
                " LIMIT 1"
            ),
            {"pid": project_id, "uid": current_user["id"]},
        )
        group_row = result.fetchone()

    # 项目组 owner/member → 放行；viewer 或无记录 → 拒绝
    if group_row and group_row[0] in ("owner", "member"):
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Viewer role has read-only access",
    )


async def check_cwd_write_permission(
    cwd: Optional[str],
    current_user: Optional[dict],
) -> None:
    """基于 cwd 的写权限检查（自动 encode 后委托 ``check_project_write_permission``）。"""
    project_id = encode_project_id(cwd or "") if cwd else ""
    await check_project_write_permission(project_id or None, current_user)


async def get_project_role(project_id: str, user_id: str) -> Optional[str]:
    """查询用户在指定项目中的角色。

    返回值：
    - 角色字符串（如 'admin', 'owner', 'member', 'viewer'）
    - 若无记录返回 None
    """
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT role FROM project_members"
                " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
            ),
            {"pid": project_id, "uid": user_id},
        )
        row = result.fetchone()
    return row[0] if row else None


async def check_project_config_permission(
    project_id: Optional[str],
    current_user: Optional[dict],
) -> None:
    """检查用户是否有权管理指定项目的配置。

    规则：
    - project_id 为 None（全局配置）：仅全局 admin 可管理
    - project_id 非空：全局 admin 或项目 admin/owner 可管理
    - current_user 为 None（TIDE_REQUIRE_AUTH=0 时）：放行
    """
    if not current_user:
        return  # TIDE_REQUIRE_AUTH=0 时放行
    if current_user.get("role") == "admin":
        return  # 全局 admin 始终放行
    if project_id is None:
        raise HTTPException(status_code=403, detail="仅管理员可管理全局配置")
    # 检查项目角色
    project_role = await get_project_role(project_id, current_user["id"])
    if project_role not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="仅项目管理员可管理项目配置")


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """从 Authorization Header 提取 Bearer token。"""
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


async def _load_user(user_id: str) -> Optional[dict]:
    """根据 user_id 查询活跃用户。"""
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT id, username, email, display_name, avatar_url,"
                " role, status, lark_open_id, lark_union_id,"
                " workspace_id, last_login_at, created_at, updated_at"
                " FROM users WHERE id = :user_id AND status = 'active'"
            ),
            {"user_id": user_id},
        )
        row = result.fetchone()
        if not row:
            return None
        return dict(row._mapping)


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> dict:
    """强制认证：无有效 access token 时返回 401。"""
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = verify_token(token)
    if payload and payload.get("type") == "access":
        # ── JWT 认证路径 ──
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user = await _load_user(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or disabled",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # 将 JWT 中的 role 同步到结果，优先以 DB 为准
        user.setdefault("role", payload.get("role", "member"))
        return user

    # ── JWT 验证失败，回退尝试 API Token ──
    from backend.api.api_tokens import verify_api_token

    api_user_id = await verify_api_token(token)
    if api_user_id:
        user = await _load_user(api_user_id)
        if user:
            user.setdefault("role", "member")
            return user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_optional_user(
    authorization: Optional[str] = Header(None),
) -> Optional[dict]:
    """可选认证：TIDE_REQUIRE_AUTH=0 且未提供 token 时返回 None。"""
    if not authorization:
        if TIDE_REQUIRE_AUTH:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return None
    return await get_current_user(authorization)


def require_role(required_role: str) -> Callable:
    """角色检查依赖工厂。

    使用方式：
        @router.get("/admin", dependencies=[Depends(require_role("admin"))])
    """

    async def check_role(
        current_user: Optional[dict] = Depends(get_optional_user),
    ) -> Optional[dict]:
        if current_user is None:
            # 未启用强制认证且未提供 token：放行
            return None
        user_level = ROLE_HIERARCHY.get(current_user.get("role", "viewer"), 0)
        required_level = ROLE_HIERARCHY.get(required_role, 0)
        if user_level < required_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return check_role


async def resolve_lark_user(open_id: str) -> Optional[dict]:
    """根据 Lark open_id 查询 users 表，返回与 get_optional_user 相同格式的 user dict。

    未找到返回 None。
    """
    if not open_id:
        return None
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT id, username, role, status, display_name, email"
                " FROM users WHERE lark_open_id = :open_id LIMIT 1"
            ),
            {"open_id": open_id},
        )
        row = result.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "username": row[1],
        "role": row[2],
        "status": row[3],
        "display_name": row[4],
        "email": row[5],
    }


class LarkPermissionDenied(Exception):
    """Lark 端权限检查失败异常"""

    def __init__(self, reason: str = "permission_denied"):
        self.reason = reason
        super().__init__(reason)


async def check_lark_permission(
    open_id: str,
    project_id: Optional[str] = None,
    require_write: bool = True,
) -> Optional[dict]:
    """Lark 端统一权限检查。

    Returns:
        user dict 或 None（当 TIDE_REQUIRE_AUTH=0 且用户未绑定时）
    Raises:
        LarkPermissionDenied: 当权限检查失败时
    """
    from backend.runtime.config import TIDE_REQUIRE_AUTH, LARK_ALLOWED_OPEN_IDS

    # 白名单前置检查
    if LARK_ALLOWED_OPEN_IDS and open_id not in LARK_ALLOWED_OPEN_IDS:
        raise LarkPermissionDenied("not_in_whitelist")

    user = await resolve_lark_user(open_id)

    # 认证模式下，未绑定用户拒绝
    if TIDE_REQUIRE_AUTH and user is None:
        raise LarkPermissionDenied("user_not_bound")

    # 未启用认证时，直接放行
    if not TIDE_REQUIRE_AUTH:
        return user

    # 用户被禁用
    if user and user.get("status") == "disabled":
        raise LarkPermissionDenied("user_disabled")

    # admin 直接放行
    if user and user.get("role") == "admin":
        return user

    # 项目级写权限检查
    if require_write and project_id and user:
        try:
            await check_project_write_permission(project_id, user)
        except HTTPException:
            raise LarkPermissionDenied("project_permission_denied")

    return user
