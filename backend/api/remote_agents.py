"""
远程 A2A Agent 管理 API。

提供远程 Agent 注册（CRUD）、Agent Card 发现、连通性测试与缓存刷新等能力。
注册后的远程 Agent 会以 `a2a:{slug}` ID 出现在 /api/agents 列表中。
"""

import base64
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
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


def _check_agent_permission(agent: dict, current_user: Optional[dict]) -> None:
    """admin 可操作所有 agent；创建者可操作自己的 agent；其他人 403。"""
    if not current_user:
        return
    if current_user.get("role") == "admin":
        return
    created_by = agent.get("created_by")
    if created_by and created_by == current_user.get("id"):
        return
    raise HTTPException(status_code=403, detail="仅管理员或创建者可操作此 Agent")


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
    scope: str = "global"
    scope_target: str = ""


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
    scope: Optional[str] = None
    scope_target: Optional[str] = None


class DiscoverRequest(BaseModel):
    url: str


class ValidateAuthRequest(BaseModel):
    """注册前的认证凭据校验请求。

    endpoint_url / agent_card_url 至少填写一项，优先使用 endpoint_url 探测。
    """

    endpoint_url: Optional[str] = None
    agent_card_url: Optional[str] = None
    auth_type: Optional[str] = "none"
    auth_credentials: Optional[str] = None
    auth_header_name: Optional[str] = None


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


def _build_probe_headers(
    auth_type: Optional[str],
    creds: Optional[str],
    header_name: Optional[str],
) -> dict[str, str]:
    """根据认证方式构造探测请求头。

    兼容前端的 ``api-key`` 与服务端历史的 ``api_key`` 两种写法。
    """
    headers: dict[str, str] = {"Accept": "application/json"}
    at = (auth_type or "none").lower()
    creds = creds or ""
    if not creds:
        return headers
    if at in ("bearer", "oauth2"):
        headers["Authorization"] = f"Bearer {creds}"
    elif at in ("api-key", "api_key"):
        headers[header_name or "X-API-Key"] = creds
    elif at == "basic":
        token = base64.b64encode(creds.encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {token}"
    return headers


async def _verify_credentials(
    endpoint_url: str,
    auth_type: Optional[str],
    auth_credentials: Optional[str],
    auth_header_name: Optional[str] = None,
) -> tuple[bool, Optional[str]]:
    """通过探测目标 endpoint 校验认证凭据。返回 (valid, error_message)。

    与 :func:`_fetch_agent_card` / :func:`validate_auth_credentials` 复用同一超时；
    401/403 视为认证被拒绝，连接失败视为无法连接。
    """
    headers = _build_probe_headers(auth_type, auth_credentials, auth_header_name)
    try:
        async with httpx.AsyncClient(
            timeout=_AGENT_CARD_FETCH_TIMEOUT, follow_redirects=True
        ) as client:
            resp = await client.get(endpoint_url, headers=headers)
    except httpx.HTTPError as exc:
        return False, f"无法连接到目标服务：{exc}"
    if resp.status_code in (401, 403):
        return False, "认证被拒绝"
    return True, None


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


def _extract_agents(card: dict[str, Any]) -> list[dict[str, Any]]:
    """解析 Agent Card 中的 A2A 扩展字段 ``agents``。

    返回规范化后的子 Agent 列表（每项含 name/description/capabilities）。
    若 card 中无 agents 字段或格式不合法，返回空列表（向后兼容）。
    """
    raw = card.get("agents")
    if not isinstance(raw, list):
        return []
    result: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("id") or "").strip()
        if not name:
            continue
        caps = item.get("capabilities") or []
        if not isinstance(caps, list):
            caps = []
        result.append(
            {
                "name": name,
                "description": item.get("description"),
                "capabilities": caps,
            }
        )
    return result


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
    "status, scope, scope_target, last_health_check, last_error, workspace_id, created_by, "
    "connection_mode, daemon_session_id, "
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


_INSERT_AGENT_SQL = text(
    """
    INSERT INTO remote_agents (
        id, name, description, agent_card_url, agent_card_json,
        endpoint_url, auth_type, auth_credentials, auth_header_name,
        capabilities_streaming, capabilities_push_notifications,
        skills_json, capability_tags, approval_policy, timeout_ms, max_retries,
        scope, scope_target,
        created_by, created_at, updated_at
    ) VALUES (
        :id, :name, :description, :agent_card_url, :agent_card_json,
        :endpoint_url, :auth_type, :auth_credentials, :auth_header_name,
        :capabilities_streaming, :capabilities_push_notifications,
        :skills_json, :capability_tags, :approval_policy, :timeout_ms, :max_retries,
        :scope, :scope_target,
        :created_by, :created_at, :updated_at
    )
    """
)


_UPSERT_AGENT_SQL = text(
    """
    INSERT INTO remote_agents (
        id, name, description, agent_card_url, agent_card_json,
        endpoint_url, auth_type, auth_credentials, auth_header_name,
        capabilities_streaming, capabilities_push_notifications,
        skills_json, capability_tags, approval_policy, timeout_ms, max_retries,
        scope, scope_target,
        created_by, created_at, updated_at
    ) VALUES (
        :id, :name, :description, :agent_card_url, :agent_card_json,
        :endpoint_url, :auth_type, :auth_credentials, :auth_header_name,
        :capabilities_streaming, :capabilities_push_notifications,
        :skills_json, :capability_tags, :approval_policy, :timeout_ms, :max_retries,
        :scope, :scope_target,
        :created_by, :created_at, :updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
        name = :name,
        description = :description,
        agent_card_url = :agent_card_url,
        agent_card_json = :agent_card_json,
        endpoint_url = :endpoint_url,
        capabilities_streaming = :capabilities_streaming,
        capabilities_push_notifications = :capabilities_push_notifications,
        skills_json = :skills_json,
        capability_tags = :capability_tags,
        status = 'active',
        last_error = NULL,
        updated_at = :updated_at
    """
)


def _build_agent_params(
    *,
    agent_id: str,
    name: str,
    description: Optional[str],
    body: "RemoteAgentCreate",
    card_json: Optional[str],
    endpoint_url: str,
    streaming: bool,
    push: bool,
    skills_json: str,
    capability_tags: str,
    created_by: Optional[str],
    now: str,
) -> dict[str, Any]:
    """构造写入 remote_agents 的参数字典（单条与拆分场景共用）。"""
    return {
        "id": agent_id,
        "name": name,
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
        "capability_tags": capability_tags,
        "approval_policy": body.approval_policy or "on-request",
        "timeout_ms": body.timeout_ms if body.timeout_ms is not None else 300000,
        "max_retries": body.max_retries if body.max_retries is not None else 2,
        "scope": body.scope or "global",
        "scope_target": body.scope_target or "",
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }


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
        "agents": _extract_agents(card),
        "capabilities": {"streaming": streaming, "pushNotifications": push},
    }


@router.post("/validate-auth")
async def validate_auth_credentials(
    body: ValidateAuthRequest,
    current_user=Depends(get_optional_user),
):
    """在注册前验证认证凭据是否有效。

    使用所提供的凭据向 endpoint_url（优先）或 agent_card_url 发起一次探测请求，
    若返回 401/403 则认为凭据无效。返回 ``{"valid": bool, "error": str | None}``。
    """
    _ensure_not_viewer(current_user)

    target = (body.endpoint_url or body.agent_card_url or "").strip()
    if not target:
        raise HTTPException(
            status_code=422,
            detail="endpoint_url 或 agent_card_url 至少填写一项",
        )

    headers = _build_probe_headers(
        body.auth_type, body.auth_credentials, body.auth_header_name
    )

    try:
        async with httpx.AsyncClient(
            timeout=_AGENT_CARD_FETCH_TIMEOUT, follow_redirects=True
        ) as client:
            resp = await client.get(target, headers=headers)
    except httpx.HTTPError as exc:
        return {"valid": False, "error": f"无法连接：{exc}"}

    if resp.status_code in (401, 403):
        return {
            "valid": False,
            "error": f"HTTP {resp.status_code}：认证被拒绝，请检查凭据是否正确",
        }

    return {"valid": True, "error": None}


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

    card: Optional[dict[str, Any]] = None
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

    # 写入前校验认证凭据：选择了非 none 认证方式且提供了凭据时，
    # 向 endpoint 发起一次探测，拒绝无效凭据。
    if (body.auth_type or "none").lower() != "none" and (body.auth_credentials or "").strip():
        valid, err = await _verify_credentials(
            endpoint_url,
            body.auth_type,
            body.auth_credentials,
            body.auth_header_name,
        )
        if not valid:
            raise HTTPException(status_code=422, detail=f"凭据验证失败：{err}")

    now = datetime.now(timezone.utc).isoformat()
    created_by = current_user.get("id") if current_user else None

    # 个人作用域自动回填 scope_target：避免 scope_target 为空导致
    # /api/agents 作用域过滤（target == user_id）失败而被隐藏。
    if body.scope == "personal" and not body.scope_target and created_by:
        body.scope_target = created_by

    # 当 Agent Card 暴露了 A2A 扩展的 agents 列表时（仅发现/自动拉取场景），
    # 为每个具体 Agent 创建独立记录；否则保持单条记录（向后兼容、手动创建）。
    sub_agents = _extract_agents(card) if card else []

    if sub_agents:
        return await _create_split_agents(
            parent_id=agent_id,
            body=body,
            card_json=card_json,
            endpoint_url=endpoint_url,
            streaming=streaming,
            push=push,
            skills_json=skills_json,
            sub_agents=sub_agents,
            created_by=created_by,
            now=now,
        )

    params = _build_agent_params(
        agent_id=agent_id,
        name=body.name,
        description=description,
        body=body,
        card_json=card_json,
        endpoint_url=endpoint_url,
        streaming=streaming,
        push=push,
        skills_json=skills_json,
        capability_tags="[]",
        created_by=created_by,
        now=now,
    )

    try:
        async with async_session_factory() as session:
            await session.execute(_INSERT_AGENT_SQL, params)
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


async def _create_split_agents(
    *,
    parent_id: str,
    body: RemoteAgentCreate,
    card_json: Optional[str],
    endpoint_url: str,
    streaming: bool,
    push: bool,
    skills_json: str,
    sub_agents: list[dict[str, Any]],
    created_by: Optional[str],
    now: str,
) -> dict[str, Any]:
    """为 Agent Card 中声明的每个子 Agent 创建独立的 remote_agents 记录。

    - ID 为 ``{parent_id}-{agent_name}``；
    - name 为具体 agent 名；endpoint_url / agent_card_url / auth / scope 等继承父级配置；
    - agent 级 capabilities 写入 capability_tags。
    已存在的同 ID 记录采用 upsert 语义更新，保证重复发现幂等。
    """
    created_ids: list[str] = []
    async with async_session_factory() as session:
        for sub in sub_agents:
            sub_name = sub["name"]
            child_id = f"{parent_id}-{_slugify(sub_name)}"
            capability_tags = json.dumps(sub.get("capabilities") or [], ensure_ascii=False)
            params = _build_agent_params(
                agent_id=child_id,
                name=sub_name,
                description=sub.get("description") or body.description,
                body=body,
                card_json=card_json,
                endpoint_url=endpoint_url,
                streaming=streaming,
                push=push,
                skills_json=skills_json,
                capability_tags=capability_tags,
                created_by=created_by,
                now=now,
            )
            await session.execute(_UPSERT_AGENT_SQL, params)
            created_ids.append(child_id)
        await session.commit()

    for child_id, sub in zip(created_ids, sub_agents):
        await _upsert_actor(child_id, sub["name"])

    items = [row for cid in created_ids if (row := await _get_agent_row(cid))]
    return {"items": items, "total": len(items)}


@router.get("")
async def list_remote_agents(
    scope: Optional[str] = None,
    current_user=Depends(get_optional_user),
):
    """列出已注册的远程 Agent。可通过 scope 查询参数过滤。

    权限规则：管理员可查看全部；普通用户仅能查看自己创建的 Agent。
    """
    conditions: list[str] = []
    params: dict[str, Any] = {}
    if scope:
        conditions.append("scope = :scope")
        params["scope"] = scope
    # 非管理员仅能查看自己创建的 Agent
    if current_user and current_user.get("role") != "admin":
        conditions.append("created_by = :user_id")
        params["user_id"] = current_user["id"]
    sql = f"SELECT {_SELECT_COLUMNS} FROM remote_agents"
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY created_at DESC"
    async with async_session_factory() as session:
        result = await session.execute(text(sql), params)
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
    _check_agent_permission(existing, current_user)

    # 仅更新客户端显式传入的字段（exclude_unset）：
    # 不会根据 scope 变更自动重新生成/覆盖 name，name 仅在客户端显式提交时更新。
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return existing

    # 若本次将作用域改为 personal 但未显式设置 scope_target，则自动回填为当前用户，
    # 与创建逻辑保持一致，避免个人作用域 Agent 因 scope_target 为空而不可见。
    eff_scope = updates.get("scope", existing.get("scope"))
    if eff_scope == "personal" and not updates.get("scope_target") and not existing.get("scope_target"):
        uid = current_user.get("id") if current_user else None
        if uid:
            updates["scope_target"] = uid

    # 若本次更新涉及认证方式或凭据变更，写入前先校验。
    if "auth_type" in updates or "auth_credentials" in updates:
        eff_auth_type = updates.get("auth_type", existing.get("auth_type"))
        eff_credentials = updates.get("auth_credentials", existing.get("auth_credentials"))
        eff_header_name = updates.get("auth_header_name", existing.get("auth_header_name"))
        eff_endpoint = (updates.get("endpoint_url") or existing.get("endpoint_url") or "").strip()
        if (
            eff_endpoint
            and (eff_auth_type or "none").lower() != "none"
            and (eff_credentials or "").strip()
        ):
            valid, err = await _verify_credentials(
                eff_endpoint,
                eff_auth_type,
                eff_credentials,
                eff_header_name,
            )
            if not valid:
                raise HTTPException(status_code=422, detail=f"凭据验证失败：{err}")

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

    try:
        async with async_session_factory() as session:
            await session.execute(
                text(
                    f"UPDATE remote_agents SET {', '.join(set_clauses)} WHERE id = :id"
                ),
                params,
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "unique" in msg or "constraint" in msg or "primary key" in msg:
            raise HTTPException(
                status_code=409,
                detail="相同作用域下已存在同名 Agent 配置，请调整名称或作用域后重试",
            )
        logger.exception("update remote_agents failed")
        raise HTTPException(status_code=500, detail=f"Failed to update remote agent: {exc}")

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
    _check_agent_permission(existing, current_user)

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

    # 若刷新后的 Agent Card 暴露了 agents 列表，则拆分为具体子 Agent 记录，
    # 并将本次不再出现的（同一 card URL 下的）旧记录标记为 offline。
    sub_agents = _extract_agents(card)
    if sub_agents:
        return await _refresh_split_agents(
            record=record,
            card=card,
            card_json=card_json,
            streaming=streaming,
            push=push,
            skills_json=skills_json,
            new_endpoint=new_endpoint,
            sub_agents=sub_agents,
            now=now,
        )

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


async def _refresh_split_agents(
    *,
    record: dict[str, Any],
    card: dict[str, Any],
    card_json: str,
    streaming: bool,
    push: bool,
    skills_json: str,
    new_endpoint: Optional[str],
    sub_agents: list[dict[str, Any]],
    now: str,
) -> dict[str, Any]:
    """刷新时根据 Agent Card 的 agents 列表更新/创建各子 Agent 记录。

    - 以当前记录推导出父前缀（去掉尾部的 ``-{agent}`` 后缀）；
    - 对每个子 Agent 执行 upsert；
    - 同一 agent_card_url 下本次未出现、非 ws 模式的记录标记为 offline。
    """
    card_url = record.get("agent_card_url") or ""
    rid = record["id"]
    rname = record.get("name") or ""
    suffix = f"-{_slugify(rname)}" if rname else ""
    parent_prefix = rid[: -len(suffix)] if suffix and rid.endswith(suffix) else rid

    pseudo_body = SimpleNamespace(
        agent_card_url=card_url,
        auth_type=record.get("auth_type"),
        auth_credentials=record.get("auth_credentials"),
        auth_header_name=record.get("auth_header_name"),
        approval_policy=record.get("approval_policy"),
        timeout_ms=record.get("timeout_ms"),
        max_retries=record.get("max_retries"),
        scope=record.get("scope"),
        scope_target=record.get("scope_target"),
    )
    created_by = record.get("created_by")

    active_ids: list[str] = []
    async with async_session_factory() as session:
        for sub in sub_agents:
            sub_name = sub["name"]
            child_id = f"{parent_prefix}-{_slugify(sub_name)}"
            capability_tags = json.dumps(sub.get("capabilities") or [], ensure_ascii=False)
            params = _build_agent_params(
                agent_id=child_id,
                name=sub_name,
                description=sub.get("description") or record.get("description"),
                body=pseudo_body,
                card_json=card_json,
                endpoint_url=new_endpoint or "",
                streaming=streaming,
                push=push,
                skills_json=skills_json,
                capability_tags=capability_tags,
                created_by=created_by,
                now=now,
            )
            params["created_at"] = record.get("created_at") or now
            await session.execute(_UPSERT_AGENT_SQL, params)
            active_ids.append(child_id)

        # 将同一 card URL 下本次不再出现的 HTTP 记录（含旧的笼统单条记录）标记为 offline
        if card_url and active_ids:
            placeholders = ",".join(f":aid{i}" for i in range(len(active_ids)))
            offline_params = {f"aid{i}": aid for i, aid in enumerate(active_ids)}
            offline_params["card_url"] = card_url
            offline_params["now"] = now
            await session.execute(
                text(
                    f"""
                    UPDATE remote_agents
                    SET status = 'offline', updated_at = :now
                    WHERE agent_card_url = :card_url
                      AND (connection_mode IS NULL OR connection_mode != 'ws')
                      AND id NOT IN ({placeholders})
                    """
                ),
                offline_params,
            )
        await session.commit()

    for child_id, sub in zip(active_ids, sub_agents):
        await _upsert_actor(child_id, sub["name"])

    items = [row for cid in active_ids if (row := await _get_agent_row(cid))]
    return {"items": items, "total": len(items)}
