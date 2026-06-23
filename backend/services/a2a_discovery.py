"""A2A Agent 发现与健康检查服务。

负责对 ``remote_agents`` 表中注册的远程 A2A Agent 提供：

- ``discover``: 通过 Agent Card URL 拉取并解析 Agent Card；
- ``health_check``: 单个 Agent 的健康探测（带延迟统计）；
- ``refresh_agent_card``: 重新拉取 Agent Card 并更新数据库缓存；
- ``validate_auth``: 通过一次 JSON-RPC 请求验证认证凭据是否有效；
- ``scheduled_check_all``: 批量巡检所有活跃远程 Agent，更新状态。
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.a2a_discovery")


# Agent Card / 健康检查 HTTP 超时（秒）
_HTTP_TIMEOUT = 10.0

# 连续不可达多少次后下线（status=inactive）
_UNREACHABLE_THRESHOLD = 3


class A2ADiscoveryService:
    """远程 Agent 发现、验证与健康检查。"""

    # ------------------------------------------------------------------ utils

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _parse_unreachable_count(last_error: Optional[str]) -> int:
        """从 ``last_error`` 字段解析此前累计的不可达次数。

        ``last_error`` 默认存储为纯文本错误消息；为支持累计计数，本服务在
        ``scheduled_check_all`` 中以 JSON 形式写入 ``{"count": N, "message": "..."}``。
        若不是 JSON 则视为 0 次。
        """

        if not last_error:
            return 0
        try:
            payload = json.loads(last_error)
            if isinstance(payload, dict):
                return int(payload.get("count") or 0)
        except (TypeError, ValueError):
            return 0
        return 0

    @staticmethod
    def _encode_error(count: int, message: str) -> str:
        return json.dumps(
            {"count": count, "message": message}, ensure_ascii=False
        )

    # ------------------------------------------------------------- DB helpers

    async def _fetch_agent(self, agent_id: str) -> Optional[dict[str, Any]]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, name, agent_card_url, endpoint_url, auth_type,
                           auth_credentials, auth_header_name, status, last_error
                    FROM remote_agents
                    WHERE id = :id
                    """
                ),
                {"id": agent_id},
            )
            row = result.fetchone()
        return dict(row._mapping) if row else None

    # ----------------------------------------------------------- public APIs

    async def discover(self, agent_card_url: str) -> dict:
        """从 URL 获取并解析 Agent Card。

        Args:
            agent_card_url: Agent Card URL，例如
                ``https://agent.example.com/.well-known/agent.json``。

        Returns:
            原始 Agent Card JSON dict。

        Raises:
            Exception: URL 不可达或返回非 JSON 时抛出。
        """

        if not agent_card_url:
            raise ValueError("agent_card_url is required")

        logger.info("A2A discover url=%s", agent_card_url)
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.get(agent_card_url)
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("A2A discover failed url=%s err=%s", agent_card_url, exc)
            raise RuntimeError(
                f"Failed to fetch Agent Card from {agent_card_url}: {exc}"
            ) from exc

        try:
            card = resp.json()
        except ValueError as exc:
            logger.warning(
                "A2A discover non-JSON url=%s body=%s",
                agent_card_url,
                resp.text[:256],
            )
            raise RuntimeError(
                f"Agent Card response is not valid JSON: {exc}"
            ) from exc

        if not isinstance(card, dict):
            raise RuntimeError("Agent Card payload is not a JSON object")

        return card

    async def health_check(self, agent_id: str) -> dict:
        """检查远程 Agent 是否可达。

        实现方式：GET 数据库中保存的 ``agent_card_url``，记录请求耗时。
        最后将探测结果写回 ``remote_agents.last_health_check`` 与 ``status``。

        Returns:
            ``{"healthy": bool, "latency_ms": int, "error": str | None}``
        """

        agent = await self._fetch_agent(agent_id)
        if not agent:
            return {
                "healthy": False,
                "latency_ms": 0,
                "error": f"Remote agent not found: {agent_id}",
            }

        url = agent.get("agent_card_url")
        if not url:
            return {
                "healthy": False,
                "latency_ms": 0,
                "error": "Remote agent has no agent_card_url",
            }

        started = time.perf_counter()
        healthy = False
        error: Optional[str] = None
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.get(url)
                if resp.is_success:
                    healthy = True
                else:
                    error = f"HTTP {resp.status_code}"
        except httpx.HTTPError as exc:
            error = str(exc)

        latency_ms = int((time.perf_counter() - started) * 1000)
        now = self._now_iso()

        # 更新 last_health_check / status / last_error
        if healthy:
            update_sql = text(
                """
                UPDATE remote_agents
                SET last_health_check = :ts,
                    last_error = NULL,
                    status = CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'active' END,
                    updated_at = :ts
                WHERE id = :id
                """
            )
            params = {"id": agent_id, "ts": now}
        else:
            update_sql = text(
                """
                UPDATE remote_agents
                SET last_health_check = :ts,
                    last_error = :err,
                    status = CASE WHEN status = 'active' THEN 'unreachable' ELSE status END,
                    updated_at = :ts
                WHERE id = :id
                """
            )
            params = {"id": agent_id, "ts": now, "err": error}

        try:
            async with async_session_factory() as session:
                await session.execute(update_sql, params)
                await session.commit()
        except Exception:  # noqa: BLE001
            logger.exception("health_check db update failed agent_id=%s", agent_id)

        if healthy:
            logger.info(
                "A2A health_check OK agent_id=%s latency_ms=%d", agent_id, latency_ms
            )
        else:
            logger.warning(
                "A2A health_check FAIL agent_id=%s latency_ms=%d err=%s",
                agent_id,
                latency_ms,
                error,
            )

        return {"healthy": healthy, "latency_ms": latency_ms, "error": error}

    async def refresh_agent_card(self, agent_id: str) -> dict:
        """重新拉取 Agent Card 并更新数据库缓存。

        更新字段：``agent_card_json``、``capabilities_streaming``、
        ``capabilities_push_notifications``、``skills_json``、``endpoint_url``。

        Returns:
            解析后的 Agent Card 关键信息 dict（来自 :meth:`_parse_agent_card`）。
        """

        agent = await self._fetch_agent(agent_id)
        if not agent:
            raise RuntimeError(f"Remote agent not found: {agent_id}")

        url = agent.get("agent_card_url")
        if not url:
            raise RuntimeError("Remote agent has no agent_card_url; nothing to refresh")

        card = await self.discover(url)
        parsed = self._parse_agent_card(card)

        now = self._now_iso()
        endpoint_url = parsed.get("endpoint_url") or agent.get("endpoint_url")

        try:
            async with async_session_factory() as session:
                await session.execute(
                    text(
                        """
                        UPDATE remote_agents
                        SET agent_card_json = :agent_card_json,
                            capabilities_streaming = :streaming,
                            capabilities_push_notifications = :push,
                            skills_json = :skills_json,
                            endpoint_url = COALESCE(:endpoint_url, endpoint_url),
                            protocol_binding = COALESCE(:protocol_binding, protocol_binding),
                            protocol_version = COALESCE(:protocol_version, protocol_version),
                            description = COALESCE(:description, description),
                            last_health_check = :ts,
                            last_error = NULL,
                            updated_at = :ts
                        WHERE id = :id
                        """
                    ),
                    {
                        "id": agent_id,
                        "agent_card_json": json.dumps(card, ensure_ascii=False),
                        "streaming": 1 if parsed["capabilities_streaming"] else 0,
                        "push": 1 if parsed["capabilities_push_notifications"] else 0,
                        "skills_json": json.dumps(
                            parsed.get("skills") or [], ensure_ascii=False
                        ),
                        "endpoint_url": endpoint_url,
                        "protocol_binding": parsed.get("protocol_binding"),
                        "protocol_version": parsed.get("protocol_version"),
                        "description": parsed.get("description"),
                        "ts": now,
                    },
                )
                await session.commit()
        except Exception:  # noqa: BLE001
            logger.exception("refresh_agent_card db update failed agent_id=%s", agent_id)
            raise

        logger.info("A2A refresh_agent_card done agent_id=%s", agent_id)
        return parsed

    async def validate_auth(self, agent_id: str) -> dict:
        """验证认证凭据是否有效。

        通过向 ``endpoint_url`` 发送一次最小化的 JSON-RPC 请求来探测。
        返回 ``{"valid": bool, "error": str | None}``。
        """

        agent = await self._fetch_agent(agent_id)
        if not agent:
            return {"valid": False, "error": f"Remote agent not found: {agent_id}"}

        endpoint = agent.get("endpoint_url")
        if not endpoint:
            return {"valid": False, "error": "Remote agent has no endpoint_url"}

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        auth_type = (agent.get("auth_type") or "none").lower()
        creds = agent.get("auth_credentials") or ""
        if creds and auth_type in ("bearer", "oauth2"):
            headers["Authorization"] = f"Bearer {creds}"
        elif creds and auth_type == "api_key":
            header_name = agent.get("auth_header_name") or "X-API-Key"
            headers[header_name] = creds

        # tasks/get with a random non-existent ID is the cheapest probe; auth
        # failures usually surface as 401/403 before the JSON-RPC layer rejects
        # the unknown task.
        payload = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tasks/get",
            "params": {"id": f"healthcheck-{uuid.uuid4().hex[:8]}"},
        }

        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.post(endpoint, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            logger.warning(
                "validate_auth http error agent_id=%s err=%s", agent_id, exc
            )
            return {"valid": False, "error": str(exc)}

        if resp.status_code in (401, 403):
            return {
                "valid": False,
                "error": f"HTTP {resp.status_code}: authentication rejected",
            }

        # 4xx/5xx 但不是认证错误 → 认证本身可能仍然有效（如 404 表示 task 不存在）
        if resp.status_code >= 500:
            return {
                "valid": False,
                "error": f"HTTP {resp.status_code}: server error",
            }

        # 解析 JSON-RPC error，识别认证相关错误码
        try:
            envelope = resp.json()
        except ValueError:
            # 非 JSON 响应：服务端可能不是合法的 A2A endpoint
            return {
                "valid": False,
                "error": f"Non-JSON response (HTTP {resp.status_code})",
            }

        if isinstance(envelope, dict) and isinstance(envelope.get("error"), dict):
            err = envelope["error"]
            code = err.get("code")
            # JSON-RPC 风格的认证失败（如 -32001 / -32002 等业务码）
            if code in (-32001, -32002, 401, 403):
                return {
                    "valid": False,
                    "error": err.get("message") or f"auth error code={code}",
                }

        return {"valid": True, "error": None}

    async def scheduled_check_all(self) -> dict:
        """批量健康检查所有 ``status in ('active', 'unreachable')`` 的远程 Agent。

        - 可达：``status='active'``，清空 ``last_error``；
        - 不可达且原状态为 active：``status='unreachable'``；
        - 累计 ≥ 3 次不可达：``status='inactive'``；
        - ``last_error`` 以 ``{"count": N, "message": "..."}`` 形式记录连续失败次数。

        Returns:
            汇总信息 ``{"checked": int, "healthy": int, "unreachable": int, "inactive": int}``。
        """

        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, agent_card_url, status, last_error
                    FROM remote_agents
                    WHERE status IN ('active', 'unreachable')
                    """
                )
            )
            rows = [dict(r._mapping) for r in result.fetchall()]

        summary = {
            "checked": 0,
            "healthy": 0,
            "unreachable": 0,
            "inactive": 0,
        }

        for row in rows:
            agent_id = row["id"]
            url = row.get("agent_card_url")
            prev_status = row.get("status") or "active"
            prev_count = self._parse_unreachable_count(row.get("last_error"))
            summary["checked"] += 1

            if not url:
                logger.warning(
                    "scheduled_check skip agent_id=%s reason=no_agent_card_url",
                    agent_id,
                )
                continue

            healthy = False
            error_msg: Optional[str] = None
            try:
                async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                    resp = await client.get(url)
                    if resp.is_success:
                        healthy = True
                    else:
                        error_msg = f"HTTP {resp.status_code}"
            except httpx.HTTPError as exc:
                error_msg = str(exc)

            now = self._now_iso()

            if healthy:
                summary["healthy"] += 1
                new_status = "active"
                params = {
                    "id": agent_id,
                    "ts": now,
                    "status": new_status,
                    "err": None,
                }
                logger.info(
                    "scheduled_check OK agent_id=%s prev_status=%s",
                    agent_id,
                    prev_status,
                )
            else:
                new_count = prev_count + 1
                if new_count >= _UNREACHABLE_THRESHOLD:
                    new_status = "inactive"
                    summary["inactive"] += 1
                else:
                    new_status = "unreachable"
                    summary["unreachable"] += 1
                params = {
                    "id": agent_id,
                    "ts": now,
                    "status": new_status,
                    "err": self._encode_error(new_count, error_msg or "unknown"),
                }
                logger.warning(
                    "scheduled_check FAIL agent_id=%s status=%s count=%d err=%s",
                    agent_id,
                    new_status,
                    new_count,
                    error_msg,
                )

            try:
                async with async_session_factory() as session:
                    await session.execute(
                        text(
                            """
                            UPDATE remote_agents
                            SET last_health_check = :ts,
                                status = :status,
                                last_error = :err,
                                updated_at = :ts
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                    await session.commit()
            except Exception:  # noqa: BLE001
                logger.exception(
                    "scheduled_check db update failed agent_id=%s", agent_id
                )

        logger.info("scheduled_check_all summary=%s", summary)
        return summary

    # --------------------------------------------------------------- parsing

    def _parse_agent_card(self, card_json: dict) -> dict:
        """从原始 Agent Card JSON 提取关键信息。

        ``supportedInterfaces`` 是 A2A v0.3+ 推荐的多协议绑定数组；为兼容
        早期 Card（直接在顶层提供 ``url``/``endpoint``），在缺失时回退到
        顶层字段。
        """

        if not isinstance(card_json, dict):
            raise ValueError("Agent Card is not a JSON object")

        # supportedInterfaces 优先
        endpoint_url: Optional[str] = None
        protocol_binding: Optional[str] = None
        interfaces = card_json.get("supportedInterfaces")
        if isinstance(interfaces, list) and interfaces:
            first = interfaces[0]
            if isinstance(first, dict):
                endpoint_url = first.get("url")
                protocol_binding = first.get("protocolBinding")

        # 回退到顶层字段
        if not endpoint_url:
            endpoint_url = card_json.get("url") or card_json.get("endpoint")
        if not protocol_binding:
            protocol_binding = card_json.get("protocolBinding") or "JSONRPC"

        protocol_version = (
            card_json.get("protocolVersion")
            or card_json.get("version")
            or "1.0"
        )

        capabilities = card_json.get("capabilities") or {}
        if not isinstance(capabilities, dict):
            capabilities = {}

        skills = card_json.get("skills") or []
        if not isinstance(skills, list):
            skills = []

        return {
            "name": card_json.get("name") or "",
            "description": card_json.get("description") or "",
            "endpoint_url": endpoint_url,
            "protocol_binding": protocol_binding,
            "protocol_version": str(protocol_version),
            "capabilities_streaming": bool(capabilities.get("streaming")),
            "capabilities_push_notifications": bool(
                capabilities.get("pushNotifications")
            ),
            "skills": skills,
        }
