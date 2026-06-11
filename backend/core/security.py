"""JWT 生成/验证 + bcrypt 密码哈希工具。

依赖：
- PyJWT：access/refresh token 编解码
- bcrypt：密码哈希
- hashlib：refresh token 存储前的二次哈希（避免明文落库）
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import bcrypt
import jwt

from backend.runtime.config import (
    TIDE_JWT_ALGORITHM,
    TIDE_JWT_EXPIRE_MINUTES,
    TIDE_JWT_SECRET,
    TIDE_REFRESH_TOKEN_EXPIRE_DAYS,
)


def hash_password(password: str) -> str:
    """使用 bcrypt 对明文密码做哈希（cost=12）。"""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证明文密码与 bcrypt 哈希是否匹配。"""
    if not plain_password or not hashed_password:
        return False
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


def create_access_token(
    user_id: str,
    role: str = "member",
    expires_delta: Optional[timedelta] = None,
) -> str:
    """生成短期 JWT access token。"""
    if expires_delta is None:
        expires_delta = timedelta(minutes=TIDE_JWT_EXPIRE_MINUTES)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "exp": now + expires_delta,
        "iat": now,
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    return jwt.encode(payload, TIDE_JWT_SECRET, algorithm=TIDE_JWT_ALGORITHM)


def create_refresh_token(
    user_id: str,
    expires_delta: Optional[timedelta] = None,
) -> Tuple[str, str]:
    """生成长期 refresh token。

    Returns:
        (token, family_id)。family_id 用于检测令牌重用攻击。
    """
    if expires_delta is None:
        expires_delta = timedelta(days=TIDE_REFRESH_TOKEN_EXPIRE_DAYS)
    family_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "exp": now + expires_delta,
        "iat": now,
        "family": family_id,
        "jti": str(uuid.uuid4()),
        "type": "refresh",
    }
    token = jwt.encode(payload, TIDE_JWT_SECRET, algorithm=TIDE_JWT_ALGORITHM)
    return token, family_id


def verify_token(token: str) -> Optional[dict]:
    """验证 JWT 签名与过期，返回 payload；失败返回 None。"""
    if not token:
        return None
    try:
        return jwt.decode(
            token,
            TIDE_JWT_SECRET,
            algorithms=[TIDE_JWT_ALGORITHM],
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def hash_token(token: str) -> str:
    """对 refresh token 做 SHA-256 哈希以便存储（避免明文落库）。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
