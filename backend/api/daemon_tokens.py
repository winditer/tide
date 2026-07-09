"""Daemon Token 管理 API。

用户可为 Daemon（a2a-bridge）连接生成专属 Token，用于 /ws/daemon 认证。
Token 明文仅在创建时返回一次，DB 中只存储 SHA-256 哈希。

供 ws_daemon.py 调用的模块级函数 verify_daemon_token 用于二阶段认证。
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from backend.core.dependencies import get_current_user
from backend.core.security import hash_token
from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.daemon_tokens")

router = APIRouter(prefix="/api/daemon-tokens", tags=["daemon-tokens"])


# ── 模型 ─────────────────────────────────────────────────


class CreateTokenRequest(BaseModel):
    name: Optional[str] = None
    expires_days: Optional[int] = None


class CreateTokenResponse(BaseModel):
    id: str
    token: str  # 明文，仅此一次返回
    name: Optional[str] = None
    expires_at: Optional[str] = None
    created_at: str


class TokenInfo(BaseModel):
    id: str
    name: Optional[str] = None
    status: str
    last_used_at: Optional[str] = None
    expires_at: Optional[str] = None
    created_at: str
    updated_at: str


# ── 模块级验证函数 ───────────────────────────────────────


async def verify_daemon_token(token: str) -> Optional[str]:
    """验证 Daemon Token，返回归属用户 ID；无效返回 None。

    供 ws_daemon.py 二阶段认证调用：命中时异步更新 last_used_at。
    """
    if not token:
        return None
    token_hash = hash_token(token)
    now = datetime.now(timezone.utc).isoformat()
    try:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, user_id FROM daemon_tokens"
                    " WHERE token_hash = :hash AND status = 'active'"
                    " AND (expires_at IS NULL OR expires_at > :now)"
                    " LIMIT 1"
                ),
                {"hash": token_hash, "now": now},
            )
            row = result.fetchone()
            if not row:
                return None
            token_id = row[0]
            user_id = row[1]
            # 异步更新 last_used_at，不阻塞认证返回
            asyncio.create_task(_touch_last_used(token_id))
            return user_id
    except Exception as e:
        logger.warning("verify_daemon_token failed: %s", e)
        return None


async def _touch_last_used(token_id: str) -> None:
    """更新指定 Token 的 last_used_at。"""
    try:
        async with async_session_factory() as session:
            now = datetime.now(timezone.utc).isoformat()
            await session.execute(
                text(
                    "UPDATE daemon_tokens SET last_used_at = :now, updated_at = :now"
                    " WHERE id = :id"
                ),
                {"now": now, "id": token_id},
            )
            await session.commit()
    except Exception as e:
        logger.debug("Failed to update last_used_at for token %s: %s", token_id, e)


# ── API 路由 ─────────────────────────────────────────────


@router.post("", response_model=CreateTokenResponse)
async def create_daemon_token(
    body: CreateTokenRequest,
    current_user: dict = Depends(get_current_user),
) -> CreateTokenResponse:
    """生成当前用户专属的 Daemon Token（明文仅返回一次）。"""
    raw_token = secrets.token_hex(32)
    token_hash = hash_token(raw_token)
    token_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    expires_at_iso: Optional[str] = None
    if body.expires_days is not None:
        if body.expires_days <= 0:
            raise HTTPException(status_code=400, detail="expires_days must be positive")
        expires_at_iso = (now + timedelta(days=body.expires_days)).isoformat()

    async with async_session_factory() as session:
        await session.execute(
            text(
                "INSERT INTO daemon_tokens"
                " (id, user_id, token_hash, name, status, expires_at, created_at, updated_at)"
                " VALUES (:id, :user_id, :token_hash, :name, 'active', :expires_at, :now, :now)"
            ),
            {
                "id": token_id,
                "user_id": current_user["id"],
                "token_hash": token_hash,
                "name": body.name,
                "expires_at": expires_at_iso,
                "now": now_iso,
            },
        )
        await session.commit()

    logger.info("Daemon token created: %s for user %s", token_id, current_user["id"])
    return CreateTokenResponse(
        id=token_id,
        token=raw_token,
        name=body.name,
        expires_at=expires_at_iso,
        created_at=now_iso,
    )


@router.get("", response_model=list[TokenInfo])
async def list_daemon_tokens(
    current_user: dict = Depends(get_current_user),
) -> list[TokenInfo]:
    """列出当前用户的 Daemon Token（不含哈希或明文，且排除已撤销的）。

    撤销为软删除（status='revoked'），此处过滤掉已撤销 Token，
    使前端撤销后重新拉取列表时该 Token 不再出现。
    """
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT id, name, status, last_used_at, expires_at, created_at, updated_at"
                " FROM daemon_tokens WHERE user_id = :user_id AND status != 'revoked'"
                " ORDER BY created_at DESC"
            ),
            {"user_id": current_user["id"]},
        )
        rows = result.fetchall()

    return [
        TokenInfo(
            id=row[0],
            name=row[1],
            status=row[2],
            last_used_at=row[3],
            expires_at=row[4],
            created_at=row[5],
            updated_at=row[6],
        )
        for row in rows
    ]


@router.delete("/{token_id}")
async def revoke_daemon_token(
    token_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """撤销当前用户的指定 Daemon Token（status → 'revoked'）。"""
    now = datetime.now(timezone.utc).isoformat()
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT user_id FROM daemon_tokens WHERE id = :id LIMIT 1"
            ),
            {"id": token_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Token not found")
        if row[0] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not your token")

        await session.execute(
            text(
                "UPDATE daemon_tokens SET status = 'revoked', updated_at = :now"
                " WHERE id = :id"
            ),
            {"id": token_id, "now": now},
        )
        await session.commit()

    logger.info("Daemon token revoked: %s by user %s", token_id, current_user["id"])
    return {"status": "revoked", "id": token_id}
