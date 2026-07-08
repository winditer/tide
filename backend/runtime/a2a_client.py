"""A2A (Agent-to-Agent) JSON-RPC protocol client.

This module implements an asynchronous client for the A2A protocol, which
exposes remote AI agents over JSON-RPC 2.0. It supports synchronous request /
response interactions (``message/send``, ``tasks/get``, ``tasks/cancel``) as
well as Server-Sent-Events streaming (``message/stream``) and Agent Card
discovery.

The client is intentionally transport-thin: it normalises JSON-RPC envelopes
and SSE events into the local :class:`A2ATask` / event ``dict`` shapes that
the rest of the runtime consumes, while leaving higher-level orchestration
(approval gating, retries beyond HTTP, persistence) to the executor layer.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Optional

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class A2AAgentConfig:
    """Connection configuration for a remote A2A agent."""

    agent_id: str
    endpoint_url: str
    auth_type: str = "none"  # bearer | api_key | oauth2 | none
    auth_credentials: str = ""
    auth_header_name: str = "X-API-Key"
    capabilities: dict = field(
        default_factory=lambda: {"streaming": False, "pushNotifications": False}
    )
    timeout_ms: int = 60_000
    max_retries: int = 0
    approval_required: bool = False
    approval_policy: str = "on-request"  # always | on-request | never
    connection_mode: str = "http"  # http | ws (Daemon WebSocket 推模式)
    daemon_session_id: str = ""


@dataclass
class A2ATask:
    """Remote task state as returned by the A2A server."""

    id: str
    context_id: Optional[str] = None
    state: str = "submitted"
    # submitted | working | completed | failed | canceled
    # | input_required | auth_required | rejected
    artifacts: list = field(default_factory=list)
    history: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class A2AClientError(RuntimeError):
    """Raised when the remote agent returns a JSON-RPC error or invalid payload."""

    def __init__(self, message: str, *, code: Optional[int] = None, data: Any = None):
        super().__init__(message)
        self.code = code
        self.data = data


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class A2AClient:
    """Asynchronous JSON-RPC client speaking the A2A protocol."""

    JSONRPC_VERSION = "2.0"
    DEFAULT_OUTPUT_MODES = ["text/plain", "application/json"]

    def __init__(self, config: A2AAgentConfig):
        self.config = config
        timeout_seconds = max(1.0, config.timeout_ms / 1000.0)
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        logger.debug(
            "A2AClient initialized agent_id=%s endpoint=%s auth_type=%s",
            config.agent_id,
            config.endpoint_url,
            config.auth_type,
        )

    # ------------------------------------------------------------------ auth

    def _build_auth_headers(self) -> dict:
        """Build authentication headers based on ``auth_type``."""

        auth_type = (self.config.auth_type or "none").lower()
        creds = self.config.auth_credentials or ""

        if auth_type == "none" or not creds:
            return {}
        if auth_type == "bearer":
            return {"Authorization": f"Bearer {creds}"}
        if auth_type == "oauth2":
            # OAuth2 access tokens are conveyed as bearer tokens on the wire.
            return {"Authorization": f"Bearer {creds}"}
        if auth_type == "api_key":
            header_name = self.config.auth_header_name or "X-API-Key"
            return {header_name: creds}

        logger.warning("Unknown A2A auth_type=%s, sending no auth header", auth_type)
        return {}

    # -------------------------------------------------------- request helpers

    def _build_jsonrpc_request(self, method: str, params: dict) -> dict:
        return {
            "jsonrpc": self.JSONRPC_VERSION,
            "id": str(uuid.uuid4()),
            "method": method,
            "params": params,
        }

    def _build_message_params(
        self,
        prompt: str,
        *,
        task_id: Optional[str],
        context_id: Optional[str],
        context_parts: Optional[list],
        metadata: Optional[dict],
    ) -> dict:
        parts: list = [{"text": prompt}]
        if context_parts:
            parts.extend(context_parts)

        message: dict[str, Any] = {
            "messageId": str(uuid.uuid4()),
            "role": "user",
            "parts": parts,
        }
        if task_id:
            message["taskId"] = task_id
        if context_id:
            message["contextId"] = context_id
        if metadata:
            message["metadata"] = metadata

        return {
            "message": message,
            "configuration": {
                "acceptedOutputModes": list(self.DEFAULT_OUTPUT_MODES),
            },
        }

    async def _post_jsonrpc(self, payload: dict) -> dict:
        """POST a JSON-RPC request and return the parsed envelope."""

        headers = self._build_auth_headers()
        try:
            response = await self._client.post(
                self.config.endpoint_url, json=payload, headers=headers
            )
        except httpx.HTTPError as exc:
            logger.exception(
                "A2A HTTP request failed agent_id=%s method=%s",
                self.config.agent_id,
                payload.get("method"),
            )
            raise A2AClientError(f"A2A HTTP request failed: {exc}") from exc

        if response.status_code >= 400:
            logger.error(
                "A2A returned HTTP %s for agent_id=%s method=%s body=%s",
                response.status_code,
                self.config.agent_id,
                payload.get("method"),
                response.text[:512],
            )
            raise A2AClientError(
                f"A2A HTTP {response.status_code}: {response.text[:512]}",
                code=response.status_code,
            )

        try:
            return response.json()
        except ValueError as exc:
            raise A2AClientError(
                f"A2A returned non-JSON response: {response.text[:256]}"
            ) from exc

    # ----------------------------------------------------------- public APIs

    async def send_message(
        self,
        prompt: str,
        task_id: Optional[str] = None,
        context_id: Optional[str] = None,
        context_parts: Optional[list] = None,
        metadata: Optional[dict] = None,
    ) -> A2ATask:
        """Send a synchronous ``message/send`` request and return the task."""

        params = self._build_message_params(
            prompt,
            task_id=task_id,
            context_id=context_id,
            context_parts=context_parts,
            metadata=metadata,
        )
        request = self._build_jsonrpc_request("message/send", params)

        logger.info(
            "A2A send_message agent_id=%s task_id=%s context_id=%s",
            self.config.agent_id,
            task_id,
            context_id,
        )
        envelope = await self._post_jsonrpc(request)
        return self._parse_task_response(envelope)

    async def send_streaming_message(
        self,
        prompt: str,
        task_id: Optional[str] = None,
        context_id: Optional[str] = None,
        context_parts: Optional[list] = None,
        metadata: Optional[dict] = None,
    ) -> AsyncGenerator[dict, None]:
        """Stream events for ``message/stream`` over SSE.

        Each yielded ``dict`` is the parsed SSE payload, normalised into one of
        ``{"type": "task" | "message" | "statusUpdate" | "artifactUpdate", ...}``.
        """

        params = self._build_message_params(
            prompt,
            task_id=task_id,
            context_id=context_id,
            context_parts=context_parts,
            metadata=metadata,
        )
        request = self._build_jsonrpc_request("message/stream", params)

        headers = self._build_auth_headers()
        headers["Accept"] = "text/event-stream"

        logger.info(
            "A2A send_streaming_message agent_id=%s task_id=%s context_id=%s",
            self.config.agent_id,
            task_id,
            context_id,
        )

        async with self._client.stream(
            "POST",
            self.config.endpoint_url,
            json=request,
            headers=headers,
        ) as response:
            if response.status_code >= 400:
                body = await response.aread()
                logger.error(
                    "A2A stream HTTP %s agent_id=%s body=%s",
                    response.status_code,
                    self.config.agent_id,
                    body[:512],
                )
                raise A2AClientError(
                    f"A2A stream HTTP {response.status_code}",
                    code=response.status_code,
                )

            async for line in response.aiter_lines():
                if not line:
                    continue
                # SSE field lines are formatted as "field: value". A2A uses
                # only the ``data:`` field; comments (lines starting with ":")
                # and other fields are ignored.
                if line.startswith(":"):
                    continue
                if not line.startswith("data:"):
                    continue
                data_str = line[len("data:") :].strip()
                if not data_str:
                    continue
                try:
                    parsed = self._parse_stream_event(data_str)
                except A2AClientError:
                    logger.exception(
                        "A2A stream event parse failed agent_id=%s line=%s",
                        self.config.agent_id,
                        data_str[:256],
                    )
                    continue
                if parsed:
                    yield parsed

    async def get_task(self, task_id: str) -> A2ATask:
        """Fetch the current state of a remote task."""

        request = self._build_jsonrpc_request("tasks/get", {"id": task_id})
        logger.info(
            "A2A get_task agent_id=%s task_id=%s", self.config.agent_id, task_id
        )
        envelope = await self._post_jsonrpc(request)
        return self._parse_task_response(envelope)

    async def cancel_task(self, task_id: str) -> A2ATask:
        """Cancel a running remote task."""

        request = self._build_jsonrpc_request("tasks/cancel", {"id": task_id})
        logger.info(
            "A2A cancel_task agent_id=%s task_id=%s", self.config.agent_id, task_id
        )
        envelope = await self._post_jsonrpc(request)
        return self._parse_task_response(envelope)

    async def discover(self, agent_card_url: str) -> dict:
        """Fetch and return an Agent Card descriptor."""

        headers = self._build_auth_headers()
        logger.info(
            "A2A discover agent_id=%s url=%s", self.config.agent_id, agent_card_url
        )
        try:
            response = await self._client.get(agent_card_url, headers=headers)
        except httpx.HTTPError as exc:
            raise A2AClientError(f"Agent card fetch failed: {exc}") from exc

        if response.status_code >= 400:
            raise A2AClientError(
                f"Agent card HTTP {response.status_code}: {response.text[:256]}",
                code=response.status_code,
            )
        try:
            return response.json()
        except ValueError as exc:
            raise A2AClientError(
                f"Agent card returned non-JSON: {response.text[:256]}"
            ) from exc

    async def close(self) -> None:
        """Close the underlying HTTP client."""

        try:
            await self._client.aclose()
        except Exception:  # noqa: BLE001 - best-effort cleanup
            logger.exception(
                "A2AClient close failed agent_id=%s", self.config.agent_id
            )

    # ------------------------------------------------------ response parsing

    def _parse_task_response(self, json_response: dict) -> A2ATask:
        """Parse a JSON-RPC envelope into an :class:`A2ATask`."""

        if not isinstance(json_response, dict):
            raise A2AClientError("A2A response is not a JSON object")

        if "error" in json_response and json_response["error"]:
            err = json_response["error"]
            if isinstance(err, dict):
                code = err.get("code")
                msg = err.get("message", "unknown JSON-RPC error")
                data = err.get("data")
            else:
                code, msg, data = None, str(err), None
            logger.error(
                "A2A JSON-RPC error agent_id=%s code=%s msg=%s",
                self.config.agent_id,
                code,
                msg,
            )
            raise A2AClientError(msg, code=code, data=data)

        result = json_response.get("result")
        if result is None:
            raise A2AClientError("A2A response missing 'result' field")

        return self._task_from_payload(result)

    def _task_from_payload(self, payload: dict) -> A2ATask:
        if not isinstance(payload, dict):
            raise A2AClientError("A2A task payload is not a JSON object")

        status = payload.get("status") or {}
        if isinstance(status, dict):
            state = status.get("state") or payload.get("state") or "submitted"
        else:
            state = payload.get("state") or "submitted"

        return A2ATask(
            id=payload.get("id") or payload.get("taskId") or "",
            context_id=payload.get("contextId") or payload.get("context_id"),
            state=str(state),
            artifacts=list(payload.get("artifacts") or []),
            history=list(payload.get("history") or []),
            metadata=dict(payload.get("metadata") or {}),
        )

    def _parse_stream_event(self, event_data: str) -> dict:
        """Parse a single SSE ``data:`` payload into a normalised event dict."""

        try:
            envelope = json.loads(event_data)
        except json.JSONDecodeError as exc:
            raise A2AClientError(f"Invalid SSE JSON: {exc}") from exc

        if not isinstance(envelope, dict):
            raise A2AClientError("SSE payload is not a JSON object")

        # The streaming endpoint also speaks JSON-RPC: each event is wrapped
        # in a ``{jsonrpc, id, result|error}`` envelope.
        if "error" in envelope and envelope["error"]:
            err = envelope["error"]
            if isinstance(err, dict):
                raise A2AClientError(
                    err.get("message", "stream error"),
                    code=err.get("code"),
                    data=err.get("data"),
                )
            raise A2AClientError(str(err))

        result = envelope.get("result", envelope)
        if not isinstance(result, dict):
            raise A2AClientError("Stream result is not a JSON object")

        kind = (
            result.get("kind")
            or result.get("type")
            or result.get("eventType")
        )

        if kind in {"task", "message", "statusUpdate", "artifactUpdate"}:
            event_type = kind
        elif "status" in result and "id" in result:
            event_type = "task"
        elif "artifact" in result:
            event_type = "artifactUpdate"
        elif result.get("role") and result.get("parts") is not None:
            event_type = "message"
        elif "state" in result:
            event_type = "statusUpdate"
        else:
            event_type = "task"

        normalised = dict(result)
        normalised["type"] = event_type
        return normalised

    # ----------------------------------------------------- async ctx manager

    async def __aenter__(self) -> "A2AClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()
