"""API Token 管理 API。

用户可生成用于程序化访问的 API Token。
Token 明文仅在创建时返回一次，DB 中只存储 SHA-256 哈希。
prefix（token 前 8 位）用于 UI 展示，便于用户识别。
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

logger = logging.getLogger("tide.api_tokens")

router = APIRouter(prefix="/api/api-tokens", tags=["api-tokens"])


# ── 模型 ─────────────────────────────────────────────────


class CreateTokenRequest(BaseModel):
    name: Optional[str] = None
    expires_days: Optional[int] = None


class CreateTokenResponse(BaseModel):
    id: str
    token: str  # 明文，仅此一次返回
    name: str
    prefix: str
    expires_at: Optional[str] = None
    created_at: str


class TokenInfo(BaseModel):
    id: str
    name: str
    prefix: str
    last_used_at: Optional[str] = None
    expires_at: Optional[str] = None
    created_at: str
    updated_at: str


# ── 模块级验证函数 ───────────────────────────────────────


async def verify_api_token(token: str) -> Optional[str]:
    """验证 API Token，返回归属用户 ID；无效返回 None。

    供 get_current_user 调用：命中时异步更新 last_used_at，不阻塞认证返回。
    """
    if not token:
        return None
    token_hash = hash_token(token)
    now = datetime.now(timezone.utc).isoformat()
    try:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, user_id FROM api_tokens"
                    " WHERE token_hash = :hash"
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
        logger.warning("verify_api_token failed: %s", e)
        return None


async def _touch_last_used(token_id: str) -> None:
    """更新指定 Token 的 last_used_at。"""
    try:
        async with async_session_factory() as session:
            now = datetime.now(timezone.utc).isoformat()
            await session.execute(
                text(
                    "UPDATE api_tokens SET last_used_at = :now, updated_at = :now"
                    " WHERE id = :id"
                ),
                {"now": now, "id": token_id},
            )
            await session.commit()
    except Exception as e:
        logger.debug("Failed to update last_used_at for token %s: %s", token_id, e)


# ── API 路由 ─────────────────────────────────────────────


@router.post("", response_model=CreateTokenResponse)
async def create_api_token(
    body: CreateTokenRequest,
    current_user: dict = Depends(get_current_user),
) -> CreateTokenResponse:
    """生成当前用户的 API Token（明文仅返回一次）。"""
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_token(raw_token)
    prefix = raw_token[:8]
    token_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    name = body.name or "API Token"

    expires_at_iso: Optional[str] = None
    if body.expires_days is not None:
        if body.expires_days <= 0:
            raise HTTPException(status_code=400, detail="expires_days must be positive")
        expires_at_iso = (now + timedelta(days=body.expires_days)).isoformat()

    async with async_session_factory() as session:
        await session.execute(
            text(
                "INSERT INTO api_tokens"
                " (id, user_id, token_hash, name, prefix, expires_at, created_at, updated_at)"
                " VALUES (:id, :user_id, :token_hash, :name, :prefix, :expires_at, :now, :now)"
            ),
            {
                "id": token_id,
                "user_id": current_user["id"],
                "token_hash": token_hash,
                "name": name,
                "prefix": prefix,
                "expires_at": expires_at_iso,
                "now": now_iso,
            },
        )
        await session.commit()

    logger.info("API token created: %s for user %s", token_id, current_user["id"])
    return CreateTokenResponse(
        id=token_id,
        token=raw_token,
        name=name,
        prefix=prefix,
        expires_at=expires_at_iso,
        created_at=now_iso,
    )


@router.get("", response_model=list[TokenInfo])
async def list_api_tokens(
    current_user: dict = Depends(get_current_user),
) -> list[TokenInfo]:
    """列出当前用户的所有 API Token（不含哈希或明文）。"""
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT id, name, prefix, last_used_at, expires_at, created_at, updated_at"
                " FROM api_tokens WHERE user_id = :user_id"
                " ORDER BY created_at DESC"
            ),
            {"user_id": current_user["id"]},
        )
        rows = result.fetchall()

    return [
        TokenInfo(
            id=row[0],
            name=row[1],
            prefix=row[2],
            last_used_at=row[3],
            expires_at=row[4],
            created_at=row[5],
            updated_at=row[6],
        )
        for row in rows
    ]


@router.delete("/{token_id}")
async def delete_api_token(
    token_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """删除当前用户的指定 API Token。"""
    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT user_id FROM api_tokens WHERE id = :id LIMIT 1"),
            {"id": token_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Token not found")
        if row[0] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not your token")

        await session.execute(
            text("DELETE FROM api_tokens WHERE id = :id"),
            {"id": token_id},
        )
        await session.commit()

    logger.info("API token deleted: %s by user %s", token_id, current_user["id"])
    return {"status": "deleted", "id": token_id}
