"""认证 API 路由。

提供本地用户名/密码登录、Lark OAuth、Token 刷新、登出、当前用户查询、修改密码等端点。
"""

from __future__ import annotations

import logging
import secrets
from typing import Optional
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from backend.core.dependencies import get_current_user
from backend.core.security import hash_password, verify_password
from backend.db.engine import async_session_factory
from backend.runtime.config import (
    APP_ID,
    LARK_APP_REDIRECT_URI,
    LARK_DOMAIN,
    TIDE_PASSWORD_MIN_LENGTH,
)
from backend.services.auth_service import auth_service

logger = logging.getLogger("tide.api.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── 请求/响应模型 ────────────────────────────────────────


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=1)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserPublic(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str = "member"
    status: str = "active"
    lark_open_id: Optional[str] = None
    lark_union_id: Optional[str] = None
    workspace_id: Optional[str] = None


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserPublic


# ── 工具函数 ────────────────────────────────────────────


_PUBLIC_USER_FIELDS = {
    "id",
    "username",
    "email",
    "display_name",
    "avatar_url",
    "role",
    "status",
    "lark_open_id",
    "lark_union_id",
    "workspace_id",
}


def _public_user(user: dict) -> dict:
    """裁剪敏感字段，仅返回前端可见的用户信息。"""
    return {k: user.get(k) for k in _PUBLIC_USER_FIELDS}


def _client_meta(request: Request) -> tuple[Optional[str], Optional[str]]:
    """提取客户端 IP / User-Agent，用于 user_sessions 落库。"""
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    return ip, ua


def _frontend_origin(request: Request) -> str:
    """根据 Referer/Origin 推断前端地址，回退到本地默认端口。"""
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    if origin:
        try:
            parsed = urlparse(origin)
            if parsed.scheme and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}"
        except (ValueError, TypeError):
            pass
    return "http://localhost:3000"


# ── 路由 ────────────────────────────────────────────────


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request) -> LoginResponse:
    """用户名/密码登录。"""
    user = await auth_service.verify_password_login(body.username, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    ip, ua = _client_meta(request)
    access_token, refresh_token = await auth_service.create_session(
        user_id=user["id"],
        ip_address=ip,
        user_agent=ua,
        role=user.get("role") or "member",
    )

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserPublic(**_public_user(user)),
    )


@router.get("/lark/authorize")
async def lark_authorize(request: Request) -> RedirectResponse:
    """构造 Lark OAuth 授权 URL 并 302 跳转。"""
    if not APP_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Lark OAuth not configured (LARK_APP_ID missing)",
        )
    if not LARK_APP_REDIRECT_URI:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Lark OAuth not configured (LARK_APP_REDIRECT_URI missing)",
        )

    # 使用配置的 LARK_DOMAIN（默认 open.larksuite.com，国内可设 open.feishu.cn）
    domain = (LARK_DOMAIN or "https://open.feishu.cn").rstrip("/")
    state = secrets.token_urlsafe(24)
    params = {
        "app_id": APP_ID,
        "redirect_uri": LARK_APP_REDIRECT_URI,
        "state": state,
    }
    url = f"{domain}/open-apis/authen/v1/authorize?{urlencode(params)}"
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@router.get("/lark/callback")
async def lark_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
) -> RedirectResponse:
    """Lark OAuth 回调：换取 user_info → 创建/更新用户 → 创建会话 → 重定向前端。"""
    frontend = _frontend_origin(request)

    if error:
        logger.warning("lark oauth callback error: %s", error)
        return RedirectResponse(
            url=f"{frontend}/auth/login?auth_error={error}",
            status_code=status.HTTP_302_FOUND,
        )

    if not code:
        return RedirectResponse(
            url=f"{frontend}/auth/login?auth_error=missing_code",
            status_code=status.HTTP_302_FOUND,
        )

    try:
        user = await auth_service.verify_lark_oauth(code)
    except ValueError as exc:
        logger.warning("lark oauth verify failed: %s", exc)
        return RedirectResponse(
            url=f"{frontend}/auth/login?auth_error={exc}",
            status_code=status.HTTP_302_FOUND,
        )
    except Exception:  # noqa: BLE001
        logger.exception("lark oauth verify unexpected error")
        return RedirectResponse(
            url=f"{frontend}/auth/login?auth_error=server_error",
            status_code=status.HTTP_302_FOUND,
        )

    ip, ua = _client_meta(request)
    access_token, refresh_token = await auth_service.create_session(
        user_id=user["id"],
        ip_address=ip,
        user_agent=ua,
        role=user.get("role") or "member",
    )

    redirect_params = urlencode({
        "token": access_token,
        "refresh_token": refresh_token,
    })
    return RedirectResponse(
        url=f"{frontend}/auth/callback?{redirect_params}",
        status_code=status.HTTP_302_FOUND,
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest) -> TokenPair:
    """用 refresh_token 旋转出新的 access/refresh token。"""
    result = await auth_service.refresh_session(body.refresh_token)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    access_token, refresh_token = result
    return TokenPair(access_token=access_token, refresh_token=refresh_token)


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)) -> dict:
    """登出：吊销当前用户的所有活跃会话。"""
    await auth_service.revoke_session(user_id=current_user["id"])
    return {"ok": True}


@router.get("/me", response_model=UserPublic)
async def me(current_user: dict = Depends(get_current_user)) -> UserPublic:
    """返回当前登录用户的公开信息。"""
    return UserPublic(**_public_user(current_user))


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """修改当前用户密码。验证旧密码 → 写入新哈希 → 吊销其他会话。"""
    if len(body.new_password) < TIDE_PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at least {TIDE_PASSWORD_MIN_LENGTH} characters",
        )
    if body.new_password == body.old_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="New password must differ from old password",
        )

    user_id = current_user["id"]

    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT password_hash FROM users WHERE id = :user_id"),
            {"user_id": user_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        stored_hash = row[0] or ""
        if not stored_hash:
            # Lark 用户从未设置过本地密码
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Local password not set for this account",
            )
        if not verify_password(body.old_password, stored_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Old password is incorrect",
            )

        from datetime import datetime, timezone

        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        await session.execute(
            text(
                "UPDATE users SET password_hash = :hash, updated_at = :now"
                " WHERE id = :user_id"
            ),
            {
                "hash": hash_password(body.new_password),
                "now": now_iso,
                "user_id": user_id,
            },
        )
        await session.commit()

    # 安全起见：吊销该用户其它活跃会话（强制其它端重新登录）
    await auth_service.revoke_session(user_id=user_id)
    return {"ok": True}
