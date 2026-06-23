"""
远程 A2A Agent 管理 API。

提供远程 Agent 注册（CRUD）、Agent Card 发现、连通性测试与缓存刷新等能力。
注册后的远程 Agent 会以 `a2a:{slug}` ID 出现在 /api/agents 列表中。
"""

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from backend.core.dependencies import get_optional_user
from backend.db.engine import async_session_factory

router = APIRouter(prefix="/api/remote-agents", tags=["remote-agents"])

logger = logging.getLogger(__name__)

# 远程 Agent Card 拉取超时（秒）
_AGENT_CARD_FETCH_TIMEOUT = 10.0


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class RemoteAgentCreate(BaseModel):
    name: str = Field(..., min_length=1)
    agent_card_url: Optional[str] = None
    endpoint_url: Optional[str] = None
    description: Optional[str] = None
    auth_type: Optional[str] = "bearer"
    auth_credentials: Optional[str] = None
    auth_header_name: Optional[str] = None
    approval_policy: Optional[str] = "on-request"
    timeout_ms: Optional[int] = 300000
    max_retries: Optional[int] = 2


class RemoteAgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    agent_card_url: Optional[str] = None
    endpoint_url: Optional[str] = None
    auth_type: Optional[str] = None
    auth_credentials: Optional[str] = None
    auth_header_name: Optional[str] = None
    approval_policy: Optional[str] = None
    approval_required: Optional[bool] = None
    timeout_ms: Optional[int] = None
    max_retries: Optional[int] = None
    status: Optional[str] = None


class DiscoverRequest(BaseModel):
    url: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_SLUG_PATTERN = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    """生成符合 a2a:{slug} 规范的 slug：小写 + 连字符。"""
    slug = _SLUG_PATTERN.sub("-", (name or "").strip().lower()).strip("-")
    return slug or uuid.uuid4().hex[:8]


async def _fetch_agent_card(url: str) -> dict[str, Any]:
    """GET 指定 URL 并解析为 JSON。失败时抛 HTTPException(502)。"""
    try:
        async with httpx.AsyncClient(timeout=_AGENT_CARD_FETCH_TIMEOUT) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Agent Card from {url}: {exc}",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Agent Card response is not valid JSON: {exc}",
        )


def _extract_capabilities(card: dict[str, Any]) -> tuple[bool, bool]:
    """从 Agent Card 解析 capabilities.streaming / pushNotifications。"""
    caps = card.get("capabilities") or {}
    if not isinstance(caps, dict):
        return False, False
    return bool(caps.get("streaming")), bool(caps.get("pushNotifications"))


def _extract_skills_json(card: dict[str, Any]) -> str:
    """提取 skills 列表并序列化为 JSON 字符串。"""
    skills = card.get("skills") or []
    if not isinstance(skills, list):
        skills = []
    try:
        return json.dumps(skills, ensure_ascii=False)
    except (TypeError, ValueError):
        return "[]"


def _row_to_dict(row) -> dict[str, Any]:
    """SQLAlchemy Row → dict，并把 JSON 字段反序列化。"""
    data = dict(row._mapping)
    raw_card = data.get("agent_card_json")
    if raw_card:
        try:
            data["agent_card"] = json.loads(raw_card)
        except (TypeError, ValueError):
            data["agent_card"] = None
    raw_skills = data.get("skills_json")
    if raw_skills:
        try:
            data["skills"] = json.loads(raw_skills)
        except (TypeError, ValueError):
            data["skills"] = []
    else:
        data["skills"] = []
    data["capabilities"] = {
        "streaming": bool(data.get("capabilities_streaming")),
        "pushNotifications": bool(data.get("capabilities_push_notifications")),
    }
    return data


_SELECT_COLUMNS = (
    "id, name, description, agent_card_url, agent_card_json, endpoint_url, "
    "protocol_binding, protocol_version, auth_type, auth_credentials, "
    "auth_header_name, capabilities_streaming, capabilities_push_notifications, "
    "skills_json, approval_required, approval_policy, timeout_ms, max_retries, "
    "status, last_health_check, last_error, workspace_id, created_by, "
    "created_at, updated_at"
)


async def _get_agent_row(agent_id: str) -> Optional[dict[str, Any]]:
    async with async_session_factory() as session:
        result = await session.execute(
            text(f"SELECT {_SELECT_COLUMNS} FROM remote_agents WHERE id = :id"),
            {"id": agent_id},
        )
        row = result.fetchone()
    return _row_to_dict(row) if row else None


async def _upsert_actor(agent_id: str, name: str) -> None:
    """同步在 actors 表登记一条远程 Agent 记录（type='remote_agent'）。

    某些历史库的 actors.type 列可能存在 CHECK 约束，约束失败时降级写入 type='agent'，
    保证主流程（remote_agents 写入）不被阻断。
    """
    metadata = json.dumps({"agent_id": agent_id, "remote": True}, ensure_ascii=False)
    payload = {
        "id": agent_id,
        "name": name,
        "metadata": metadata,
    }
    insert_sql = text(
        """
        INSERT OR REPLACE INTO actors (id, type, name, metadata)
        VALUES (:id, :type, :name, :metadata)
        """
    )
    for actor_type in ("remote_agent", "agent"):
        try:
            async with async_session_factory() as session:
                await session.execute(insert_sql, {**payload, "type": actor_type})
                await session.commit()
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "upsert actors failed (type=%s, id=%s): %s",
                actor_type,
                agent_id,
                exc,
            )
    logger.error("upsert actors permanently failed for %s", agent_id)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/discover")
async def discover_agent_card(
    body: DiscoverRequest,
    current_user=Depends(get_optional_user),
):
    """通过 Agent Card URL 发现远程 Agent 元信息。"""
    if not body.url:
        raise HTTPException(status_code=400, detail="url is required")
    card = await _fetch_agent_card(body.url)
    streaming, push = _extract_capabilities(card)
    return {
        "url": body.url,
        "agent_card": card,
        "name": card.get("name"),
        "description": card.get("description"),
        "endpoint_url": card.get("url") or card.get("endpoint"),
        "skills": card.get("skills") or [],
        "capabilities": {"streaming": streaming, "pushNotifications": push},
    }


@router.post("")
async def create_remote_agent(
    body: RemoteAgentCreate,
    current_user=Depends(get_optional_user),
):
    """注册一个远程 Agent。

    - 生成 ID `a2a:{slug}`（slug 由 name 派生）
    - 若提供 agent_card_url，则尝试拉取 Agent Card 并解析 capabilities/skills/endpoint
    - 同步在 actors 表登记一条 `remote_agent` 记录
    """
    _ensure_not_viewer(current_user)

    agent_id = f"a2a:{_slugify(body.name)}"

    card_json: Optional[str] = None
    streaming = False
    push = False
    skills_json = "[]"
    description = body.description
    endpoint_url = body.endpoint_url

    if body.agent_card_url:
        card = await _fetch_agent_card(body.agent_card_url)
        card_json = json.dumps(card, ensure_ascii=False)
        streaming, push = _extract_capabilities(card)
        skills_json = _extract_skills_json(card)
        description = description or card.get("description")
        endpoint_url = endpoint_url or card.get("url") or card.get("endpoint")

    if not endpoint_url:
        raise HTTPException(
            status_code=422,
            detail="endpoint_url is required (either provided directly or resolvable from Agent Card)",
        )

    now = datetime.now(timezone.utc).isoformat()
    created_by = current_user.get("id") if current_user else None

    params = {
        "id": agent_id,
        "name": body.name,
        "description": description,
        "agent_card_url": body.agent_card_url or "",
        "agent_card_json": card_json,
        "endpoint_url": endpoint_url,
        "auth_type": body.auth_type or "bearer",
        "auth_credentials": body.auth_credentials,
        "auth_header_name": body.auth_header_name,
        "capabilities_streaming": 1 if streaming else 0,
        "capabilities_push_notifications": 1 if push else 0,
        "skills_json": skills_json,
        "approval_policy": body.approval_policy or "on-request",
        "timeout_ms": body.timeout_ms if body.timeout_ms is not None else 300000,
        "max_retries": body.max_retries if body.max_retries is not None else 2,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }

    try:
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO remote_agents (
                        id, name, description, agent_card_url, agent_card_json,
                        endpoint_url, auth_type, auth_credentials, auth_header_name,
                        capabilities_streaming, capabilities_push_notifications,
                        skills_json, approval_policy, timeout_ms, max_retries,
                        created_by, created_at, updated_at
                    ) VALUES (
                        :id, :name, :description, :agent_card_url, :agent_card_json,
                        :endpoint_url, :auth_type, :auth_credentials, :auth_header_name,
                        :capabilities_streaming, :capabilities_push_notifications,
                        :skills_json, :approval_policy, :timeout_ms, :max_retries,
                        :created_by, :created_at, :updated_at
                    )
                    """
                ),
                params,
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "unique" in msg or "primary key" in msg:
            raise HTTPException(
                status_code=409,
                detail=f"Remote agent already exists: {agent_id}",
            )
        logger.exception("insert remote_agents failed")
        raise HTTPException(status_code=500, detail=f"Failed to create remote agent: {exc}")

    await _upsert_actor(agent_id, body.name)

    created = await _get_agent_row(agent_id)
    if not created:
        raise HTTPException(status_code=500, detail="Remote agent created but not retrievable")
    return created


@router.get("")
async def list_remote_agents(current_user=Depends(get_optional_user)):
    """列出所有已注册的远程 Agent。"""
    async with async_session_factory() as session:
        result = await session.execute(
            text(f"SELECT {_SELECT_COLUMNS} FROM remote_agents ORDER BY created_at DESC")
        )
        rows = result.fetchall()
    items = [_row_to_dict(r) for r in rows]
    return {"items": items, "total": len(items)}


@router.get("/{agent_id}")
async def get_remote_agent(
    agent_id: str,
    current_user=Depends(get_optional_user),
):
    """获取远程 Agent 详情。"""
    record = await _get_agent_row(agent_id)
    if not record:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    return record


@router.put("/{agent_id}")
async def update_remote_agent(
    agent_id: str,
    body: RemoteAgentUpdate,
    current_user=Depends(get_optional_user),
):
    """更新远程 Agent 配置。"""
    _ensure_not_viewer(current_user)
    existing = await _get_agent_row(agent_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Remote agent not found")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return existing

    set_clauses: list[str] = []
    params: dict[str, Any] = {"id": agent_id}
    for key, value in updates.items():
        if key in ("approval_required",):
            set_clauses.append(f"{key} = :{key}")
            params[key] = 1 if value else 0
        else:
            set_clauses.append(f"{key} = :{key}")
            params[key] = value

    set_clauses.append("updated_at = :updated_at")
    params["updated_at"] = datetime.now(timezone.utc).isoformat()

    async with async_session_factory() as session:
        await session.execute(
            text(
                f"UPDATE remote_agents SET {', '.join(set_clauses)} WHERE id = :id"
            ),
            params,
        )
        await session.commit()

    # 同步 actors.name（若提供了新名字）
    new_name = updates.get("name")
    if new_name:
        await _upsert_actor(agent_id, new_name)

    return await _get_agent_row(agent_id)


@router.delete("/{agent_id}")
async def delete_remote_agent(
    agent_id: str,
    current_user=Depends(get_optional_user),
):
    """删除远程 Agent（同时移除 actors 中对应记录）。"""
    _ensure_not_viewer(current_user)
    existing = await _get_agent_row(agent_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Remote agent not found")

    async with async_session_factory() as session:
        await session.execute(
            text("DELETE FROM remote_agents WHERE id = :id"),
            {"id": agent_id},
        )
        try:
            await session.execute(
                text("DELETE FROM actors WHERE id = :id"),
                {"id": agent_id},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("delete actors failed for %s: %s", agent_id, exc)
        await session.commit()

    return {"ok": True, "id": agent_id}


@router.post("/{agent_id}/test")
async def test_remote_agent(
    agent_id: str,
    current_user=Depends(get_optional_user),
):
    """测试远程 Agent 连通性：GET 其 Agent Card URL。"""
    _ensure_not_viewer(current_user)
    record = await _get_agent_row(agent_id)
    if not record:
        raise HTTPException(status_code=404, detail="Remote agent not found")

    url = record.get("agent_card_url")
    if not url:
        raise HTTPException(
            status_code=422,
            detail="Remote agent has no agent_card_url; cannot test reachability",
        )

    now = datetime.now(timezone.utc).isoformat()
    try:
        async with httpx.AsyncClient(timeout=_AGENT_CARD_FETCH_TIMEOUT) as client:
            resp = await client.get(url)
            ok = resp.is_success
            status_code = resp.status_code
            error_msg = None if ok else f"HTTP {status_code}"
    except httpx.HTTPError as exc:
        ok = False
        status_code = 0
        error_msg = str(exc)

    async with async_session_factory() as session:
        await session.execute(
            text(
                """
                UPDATE remote_agents
                SET last_health_check = :ts,
                    last_error = :err,
                    updated_at = :ts
                WHERE id = :id
                """
            ),
            {"id": agent_id, "ts": now, "err": error_msg},
        )
        await session.commit()

    return {
        "ok": ok,
        "id": agent_id,
        "url": url,
        "status_code": status_code,
        "error": error_msg,
        "checked_at": now,
    }


@router.post("/{agent_id}/refresh")
async def refresh_remote_agent(
    agent_id: str,
    current_user=Depends(get_optional_user),
):
    """重新获取 Agent Card 并更新本地缓存。"""
    _ensure_not_viewer(current_user)
    record = await _get_agent_row(agent_id)
    if not record:
        raise HTTPException(status_code=404, detail="Remote agent not found")

    url = record.get("agent_card_url")
    if not url:
        raise HTTPException(
            status_code=422,
            detail="Remote agent has no agent_card_url; nothing to refresh",
        )

    card = await _fetch_agent_card(url)
    streaming, push = _extract_capabilities(card)
    skills_json = _extract_skills_json(card)
    card_json = json.dumps(card, ensure_ascii=False)
    now = datetime.now(timezone.utc).isoformat()
    new_endpoint = card.get("url") or card.get("endpoint") or record.get("endpoint_url")

    async with async_session_factory() as session:
        await session.execute(
            text(
                """
                UPDATE remote_agents
                SET agent_card_json = :agent_card_json,
                    capabilities_streaming = :streaming,
                    capabilities_push_notifications = :push,
                    skills_json = :skills_json,
                    endpoint_url = :endpoint_url,
                    description = COALESCE(:description, description),
                    last_health_check = :ts,
                    last_error = NULL,
                    updated_at = :ts
                WHERE id = :id
                """
            ),
            {
                "id": agent_id,
                "agent_card_json": card_json,
                "streaming": 1 if streaming else 0,
                "push": 1 if push else 0,
                "skills_json": skills_json,
                "endpoint_url": new_endpoint,
                "description": card.get("description"),
                "ts": now,
            },
        )
        await session.commit()

    return await _get_agent_row(agent_id)
