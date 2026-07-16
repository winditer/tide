"""AuthService — 认证业务逻辑层。

职责：
- 用户名 / 密码登录校验
- Lark OAuth 登录（查找或创建本地用户）
- 会话创建 / 刷新 / 吊销
- 启动时确保管理员存在
- 查询用户可访问的项目列表
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import text

from backend.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    verify_password,
    verify_token,
)
from backend.db.engine import async_session_factory
from backend.runtime.config import (
    APP_ID,
    APP_SECRET,
    LARK_DOMAIN,
    TIDE_ADMIN_PASSWORD,
    TIDE_ADMIN_USERNAME,
    TIDE_REFRESH_TOKEN_EXPIRE_DAYS,
)

logger = logging.getLogger("tide.auth_service")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class AuthService:
    """认证业务服务（单例）。"""

    # ── 密码登录 ─────────────────────────────────────────

    async def verify_password_login(
        self,
        username: str,
        password: str,
    ) -> Optional[dict]:
        """根据 username/email 查询用户并校验密码，成功返回用户字典。"""
        if not username or not password:
            return None

        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, username, email, password_hash, display_name,"
                    " avatar_url, role, status, lark_open_id, lark_union_id,"
                    " workspace_id"
                    " FROM users"
                    " WHERE (username = :ident OR email = :ident)"
                    " AND status = 'active'"
                    " LIMIT 1"
                ),
                {"ident": username},
            )
            row = result.fetchone()

        if not row:
            return None

        user = dict(row._mapping)
        password_hash = user.get("password_hash") or ""
        if not password_hash:
            # Lark 用户没有密码，禁止密码登录
            return None
        if not verify_password(password, password_hash):
            return None

        await self._update_last_login(user["id"])
        user.pop("password_hash", None)
        return user

    async def _update_last_login(self, user_id: str) -> None:
        async with async_session_factory() as session:
            await session.execute(
                text(
                    "UPDATE users SET last_login_at = :now,"
                    " updated_at = :now WHERE id = :user_id"
                ),
                {"user_id": user_id, "now": _now_iso()},
            )
            await session.commit()

    # ── Lark OAuth ───────────────────────────────────────

    async def verify_lark_oauth(self, code: str) -> dict:
        """用 Lark OAuth code 换取 user_info 并查找 / 创建本地用户。

        当前实现：调用 lark_oapi SDK 的 OIDC 接口；若 SDK / 配置缺失则抛错。
        失败时直接抛 ValueError，由调用方转换为 HTTP 4xx。
        """
        if not code:
            raise ValueError("Missing OAuth code")
        if not APP_ID or not APP_SECRET:
            raise ValueError("Lark OAuth not configured")

        user_info = await self._exchange_lark_code(code)
        if not user_info:
            raise ValueError("Failed to exchange Lark code")

        open_id = user_info.get("open_id") or ""
        union_id = user_info.get("union_id") or ""
        if not open_id:
            raise ValueError("Lark user_info missing open_id")

        display_name = (
            user_info.get("name")
            or user_info.get("en_name")
            or open_id
        )
        avatar_url = user_info.get("avatar_url") or user_info.get("avatar_middle") or ""
        email = user_info.get("email") or user_info.get("enterprise_email") or None

        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, username, email, display_name, avatar_url,"
                    " role, status, lark_open_id, lark_union_id, workspace_id"
                    " FROM users WHERE lark_open_id = :open_id LIMIT 1"
                ),
                {"open_id": open_id},
            )
            row = result.fetchone()

            if row:
                user = dict(row._mapping)
                # 同步可能变化的资料字段
                await session.execute(
                    text(
                        "UPDATE users SET display_name = :display_name,"
                        " avatar_url = :avatar_url,"
                        " lark_union_id = COALESCE(:union_id, lark_union_id),"
                        " last_login_at = :now, updated_at = :now"
                        " WHERE id = :user_id"
                    ),
                    {
                        "display_name": display_name,
                        "avatar_url": avatar_url,
                        "union_id": union_id or None,
                        "now": _now_iso(),
                        "user_id": user["id"],
                    },
                )
                await session.commit()
                user["display_name"] = display_name
                user["avatar_url"] = avatar_url
                if union_id:
                    user["lark_union_id"] = union_id
                return user

            # 新建本地用户
            new_id = str(uuid.uuid4())
            username = f"lark_{open_id[:12]}"
            now = _now_iso()
            await session.execute(
                text(
                    "INSERT INTO users"
                    " (id, username, email, password_hash, display_name,"
                    "  avatar_url, role, status, lark_open_id, lark_union_id,"
                    "  workspace_id, last_login_at, created_at, updated_at)"
                    " VALUES (:id, :username, :email, NULL, :display_name,"
                    "  :avatar_url, 'member', 'active', :open_id, :union_id,"
                    "  'default', :now, :now, :now)"
                ),
                {
                    "id": new_id,
                    "username": username,
                    "email": email,
                    "display_name": display_name,
                    "avatar_url": avatar_url,
                    "open_id": open_id,
                    "union_id": union_id or None,
                    "now": now,
                },
            )
            await session.commit()

        return {
            "id": new_id,
            "username": username,
            "email": email,
            "display_name": display_name,
            "avatar_url": avatar_url,
            "role": "member",
            "status": "active",
            "lark_open_id": open_id,
            "lark_union_id": union_id or None,
            "workspace_id": "default",
        }

    async def _exchange_lark_code(self, code: str) -> Optional[dict]:
        """调用 Lark OIDC 接口换取 user_info。

        流程：
        1. POST /open-apis/auth/v3/app_access_token/internal
           取得 app_access_token
        2. POST /open-apis/authen/v1/oidc/access_token
           用 code + app_access_token 换 user_access_token
        3. GET  /open-apis/authen/v1/user_info
           用 user_access_token 取 open_id / union_id / name / avatar / email

        失败（HTTP 异常 / Lark 返回 code != 0）时记录日志并返回 None。
        """
        import httpx

        domain = (LARK_DOMAIN or "https://open.feishu.cn").rstrip("/")
        app_token_url = f"{domain}/open-apis/auth/v3/app_access_token/internal"
        oidc_token_url = f"{domain}/open-apis/authen/v1/oidc/access_token"
        user_info_url = f"{domain}/open-apis/authen/v1/user_info"

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # 1) app_access_token
                resp = await client.post(
                    app_token_url,
                    json={"app_id": APP_ID, "app_secret": APP_SECRET},
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                app_payload = resp.json() or {}
                app_token = app_payload.get("app_access_token") or ""
                # 国内/国际版返回结构：成功时 code=0；某些路径下 code 字段缺省即视为成功
                app_code = app_payload.get("code", 0)
                if not app_token or app_code not in (0, None):
                    logger.warning(
                        "Lark app_access_token failed: code=%s msg=%s",
                        app_code, app_payload.get("msg"),
                    )
                    return None

                # 2) code -> user_access_token
                resp = await client.post(
                    oidc_token_url,
                    json={"grant_type": "authorization_code", "code": code},
                    headers={
                        "Authorization": f"Bearer {app_token}",
                        "Content-Type": "application/json",
                    },
                )
                resp.raise_for_status()
                token_payload = resp.json() or {}
                if token_payload.get("code", 0) not in (0, None):
                    logger.warning(
                        "Lark oidc/access_token failed: code=%s msg=%s",
                        token_payload.get("code"), token_payload.get("msg"),
                    )
                    return None
                user_token = (token_payload.get("data") or {}).get("access_token") or ""
                if not user_token:
                    logger.warning("Lark oidc/access_token missing access_token")
                    return None

                # 3) user_info
                resp = await client.get(
                    user_info_url,
                    headers={"Authorization": f"Bearer {user_token}"},
                )
                resp.raise_for_status()
                info_payload = resp.json() or {}
                if info_payload.get("code", 0) not in (0, None):
                    logger.warning(
                        "Lark user_info failed: code=%s msg=%s",
                        info_payload.get("code"), info_payload.get("msg"),
                    )
                    return None
                data = info_payload.get("data") or {}
        except httpx.HTTPError as exc:
            logger.warning("Lark OAuth HTTP error: %s", exc)
            return None
        except Exception:  # noqa: BLE001
            logger.exception("Lark OAuth exchange unexpected error")
            return None

        return {
            "open_id": data.get("open_id") or "",
            "union_id": data.get("union_id") or "",
            "name": data.get("name") or data.get("en_name") or "",
            "en_name": data.get("en_name") or "",
            "avatar_url": (
                data.get("avatar_url")
                or data.get("avatar_big")
                or data.get("avatar_middle")
                or ""
            ),
            "email": data.get("email") or data.get("enterprise_email") or None,
            "enterprise_email": data.get("enterprise_email") or None,
        }

    # ── 会话管理 ─────────────────────────────────────────

    async def create_session(
        self,
        user_id: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        role: str = "member",
    ) -> Tuple[str, str]:
        """创建会话：生成 access/refresh token 并落库。

        Returns:
            (access_token, refresh_token)
        """
        access_token = create_access_token(user_id, role=role)
        refresh_token, _family_id = create_refresh_token(user_id)

        session_id = str(uuid.uuid4())
        token_hash = hash_token(refresh_token)
        expires_at = (
            datetime.now(timezone.utc)
            + timedelta(days=TIDE_REFRESH_TOKEN_EXPIRE_DAYS)
        ).isoformat().replace("+00:00", "Z")
        now = _now_iso()

        async with async_session_factory() as session:
            await session.execute(
                text(
                    "INSERT INTO user_sessions"
                    " (id, user_id, refresh_token_hash, ip_address, user_agent,"
                    "  is_active, expires_at, created_at, last_used_at)"
                    " VALUES (:id, :user_id, :hash, :ip, :ua,"
                    "  1, :expires_at, :now, :now)"
                ),
                {
                    "id": session_id,
                    "user_id": user_id,
                    "hash": token_hash,
                    "ip": ip_address,
                    "ua": user_agent,
                    "expires_at": expires_at,
                    "now": now,
                },
            )
            await session.commit()

        return access_token, refresh_token

    async def refresh_session(
        self,
        refresh_token: str,
    ) -> Optional[Tuple[str, str]]:
        """校验 refresh token 并旋转下发新的 (access, refresh)。

        - 校验 JWT 签名 / 过期 / type='refresh'
        - 校验 DB 中存在对应活跃 session
        - 旋转：吊销旧 session、写入新 session
        失败时返回 None。
        """
        if not refresh_token:
            return None

        payload = verify_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            return None

        user_id = payload.get("sub")
        if not user_id or not isinstance(user_id, str):
            return None

        token_hash = hash_token(refresh_token)

        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id FROM user_sessions"
                    " WHERE user_id = :user_id"
                    " AND refresh_token_hash = :hash"
                    " AND is_active = 1"
                    " AND datetime(expires_at) > datetime('now')"
                    " LIMIT 1"
                ),
                {"user_id": user_id, "hash": token_hash},
            )
            row = result.fetchone()
            if not row:
                return None
            old_session_id = row[0]

            user_row = await session.execute(
                text(
                    "SELECT role, status FROM users WHERE id = :user_id"
                ),
                {"user_id": user_id},
            )
            user = user_row.fetchone()
            if not user or user[1] != "active":
                return None
            role = user[0] or "member"

            # 旋转：吊销旧 session
            await session.execute(
                text(
                    "UPDATE user_sessions SET is_active = 0,"
                    " last_used_at = :now WHERE id = :sid"
                ),
                {"sid": old_session_id, "now": _now_iso()},
            )
            await session.commit()

        return await self.create_session(user_id, role=role)

    async def revoke_session(
        self,
        user_id: str,
        session_id: Optional[str] = None,
    ) -> None:
        """吊销会话。session_id 为空时吊销该用户所有活跃会话。"""
        async with async_session_factory() as session:
            if session_id:
                await session.execute(
                    text(
                        "UPDATE user_sessions SET is_active = 0,"
                        " last_used_at = :now"
                        " WHERE id = :sid AND user_id = :user_id"
                    ),
                    {
                        "sid": session_id,
                        "user_id": user_id,
                        "now": _now_iso(),
                    },
                )
            else:
                await session.execute(
                    text(
                        "UPDATE user_sessions SET is_active = 0,"
                        " last_used_at = :now WHERE user_id = :user_id"
                    ),
                    {"user_id": user_id, "now": _now_iso()},
                )
            await session.commit()

    # ── 管理员初始化 ─────────────────────────────────────

    async def ensure_admin_exists(self) -> None:
        """启动时检查是否存在管理员，缺失则按配置创建。

        - 若 users 表内已有 role='admin' 用户，跳过
        - 否则要求 TIDE_ADMIN_PASSWORD 非空，使用 TIDE_ADMIN_USERNAME 创建
        - 未配置密码时仅 warning，不抛错（避免阻塞启动）
        """
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id FROM users WHERE role = 'admin'"
                    " AND status = 'active' LIMIT 1"
                )
            )
            if result.fetchone():
                return

            if not TIDE_ADMIN_PASSWORD:
                logger.warning(
                    "No admin user exists and TIDE_ADMIN_PASSWORD is empty;"
                    " skip auto-create."
                )
                return

            now = _now_iso()
            await session.execute(
                text(
                    "INSERT INTO users"
                    " (id, username, password_hash, display_name, role,"
                    "  status, workspace_id, created_at, updated_at)"
                    " VALUES (:id, :username, :password_hash, :display_name,"
                    "  'admin', 'active', 'default', :now, :now)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "username": TIDE_ADMIN_USERNAME,
                    "password_hash": hash_password(TIDE_ADMIN_PASSWORD),
                    "display_name": TIDE_ADMIN_USERNAME,
                    "now": now,
                },
            )
            await session.commit()
            logger.info(
                "Bootstrap admin user created: username=%s",
                TIDE_ADMIN_USERNAME,
            )

    # ── 项目可见性 ───────────────────────────────────────

    async def get_user_accessible_projects(self, user_id: str) -> list:
        """返回用户可访问的项目 ID 列表（admin 返回 ['*']）。"""
        if not user_id:
            return []

        async with async_session_factory() as session:
            user_row = await session.execute(
                text("SELECT role FROM users WHERE id = :user_id"),
                {"user_id": user_id},
            )
            user = user_row.fetchone()
            if not user:
                return []
            if (user[0] or "") == "admin":
                return ["*"]

            result = await session.execute(
                text(
                    "SELECT project_id FROM project_members"
                    " WHERE user_id = :user_id"
                ),
                {"user_id": user_id},
            )
            rows = result.fetchall()

        return [row[0] for row in rows if row[0]]


auth_service = AuthService()
