"""HookEngine — Hooks 事件驱动执行引擎。

提供：
- ``trigger(event, workspace_id, payload)``：触发指定事件的所有匹配 Hooks。
- 支持 4 种 action：``script`` / ``webhook`` / ``notification`` / ``skill``。
- 单个 hook 执行超时 30s，失败不阻塞主流程。

调用方应使用 ``asyncio.create_task(hook_engine.trigger(...))`` 包裹，
避免任何 Hook 异常或耗时影响业务主路径。
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text

from backend.core.scope_utils import match_project_scope
from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.hook_engine")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def _get_project_group_ids(project_id: Optional[str]) -> set[str]:
    """查询指定项目所属的所有项目组 ID 集合。"""
    if not project_id:
        return set()
    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT group_id FROM project_group_members WHERE project_id = :pid"),
            {"pid": project_id},
        )
        return {r[0] for r in result.fetchall()}


def _safe_json_loads(raw: Any, default: Any) -> Any:
    if raw is None or raw == "":
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


class HookEngine:
    """Hook 执行引擎（单例）。"""

    # ── trigger ─────────────────────────────────────────

    async def trigger(self, event: str, workspace_id: str, payload: dict, project_id: Optional[str] = None):
        """触发指定事件的所有匹配 Hooks（异步执行，失败不阻塞主流程）。"""
        try:
            hooks = await self._load_hooks(workspace_id, event, project_id=project_id)
        except Exception:
            logger.exception("Hook load failed: event=%s ws=%s", event, workspace_id)
            return

        if not hooks:
            return

        # 注入 event 字段，方便条件匹配与下游消费
        enriched = dict(payload or {})
        enriched.setdefault("event", event)
        enriched.setdefault("workspace_id", workspace_id)

        for hook in hooks:
            if not self._match_conditions(hook, enriched):
                continue
            try:
                await asyncio.wait_for(
                    self._execute_action(hook, enriched),
                    timeout=30.0,
                )
            except asyncio.TimeoutError:
                logger.warning("Hook %s timed out", hook.get("id"))
            except Exception as exc:  # noqa: BLE001
                logger.error("Hook %s failed: %s", hook.get("id"), exc)

    # ── load ────────────────────────────────────────────

    async def _load_hooks(self, workspace_id: str, event: str, project_id: Optional[str] = None) -> list[dict]:
        """从数据库加载匹配指定 workspace + event 的 enabled hooks，按 priority DESC 排序。

        当 project_id 提供时，加载全局 hooks（project_id IS NULL）和项目级 hooks 两层。
        """
        async with async_session_factory() as session:
            if project_id:
                result = await session.execute(
                    text(
                        """
                        SELECT id, workspace_id, name, event, action_type, action_config,
                               conditions, project_id, priority, enabled, created_at, updated_at
                        FROM hooks
                        WHERE workspace_id = :workspace_id
                          AND event = :event
                          AND enabled = 1
                          AND (project_id IS NULL OR project_id = :pid)
                        ORDER BY priority DESC, created_at ASC
                        """
                    ),
                    {"workspace_id": workspace_id, "event": event, "pid": project_id},
                )
            else:
                result = await session.execute(
                    text(
                        """
                        SELECT id, workspace_id, name, event, action_type, action_config,
                               conditions, project_id, priority, enabled, created_at, updated_at
                        FROM hooks
                        WHERE workspace_id = :workspace_id
                          AND event = :event
                          AND enabled = 1
                          AND project_id IS NULL
                        ORDER BY priority DESC, created_at ASC
                        """
                    ),
                    {"workspace_id": workspace_id, "event": event},
                )
            rows = result.fetchall()
        return [dict(r._mapping) for r in rows]

    # ── condition match ─────────────────────────────────

    def _match_conditions(self, hook: dict, payload: dict) -> bool:
        """评估 hook 的条件过滤器。

        ``conditions`` 是 JSON 字典（例如 ``{"agent_id": "codex", "status": "completed"}``），
        所有键值都需要与 payload 顶层字段完全匹配（AND 逻辑）。
        条件为空/None 时视为通过。
        """
        raw = hook.get("conditions")
        conditions = _safe_json_loads(raw, None)
        if not conditions:
            return True
        if not isinstance(conditions, dict):
            logger.warning(
                "Hook %s conditions is not a dict: %r", hook.get("id"), conditions
            )
            return True
        for key, expected in conditions.items():
            actual = payload.get(key)
            if actual != expected:
                return False
        return True

    # ── execute action ──────────────────────────────────

    async def _execute_action(self, hook: dict, payload: dict):
        """执行 hook action。"""
        action_type = hook.get("action_type") or ""
        raw_config = hook.get("action_config")
        config = _safe_json_loads(raw_config, {}) if isinstance(raw_config, str) else (raw_config or {})
        if not isinstance(config, dict):
            logger.warning("Hook %s action_config is not a dict", hook.get("id"))
            return

        if action_type == "script":
            await self._run_script(config, payload)
        elif action_type == "webhook":
            await self._send_webhook(config, payload)
        elif action_type == "notification":
            await self._send_notification(config, payload)
        elif action_type == "skill":
            await self._invoke_skill(config, payload)
        else:
            logger.warning("Hook %s unknown action_type=%s", hook.get("id"), action_type)

    async def _run_script(self, config: dict, payload: dict):
        """执行本地脚本，将 payload 通过 stdin JSON 传入。

        config 字段：
        - ``command``：必填，可以是字符串或 list[str]
        - ``cwd``：可选，工作目录
        - ``env``：可选，环境变量增量
        - ``shell``：可选，bool，默认按是否为字符串自动判断
        """
        command = config.get("command")
        if not command:
            logger.warning("Hook script missing 'command'")
            return

        cwd = config.get("cwd") or None
        env_extra = config.get("env") or None
        env = None
        if env_extra:
            import os
            env = {**os.environ, **{str(k): str(v) for k, v in env_extra.items()}}

        stdin_payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        if isinstance(command, list):
            proc = await asyncio.create_subprocess_exec(
                *[str(c) for c in command],
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )
        else:
            proc = await asyncio.create_subprocess_shell(
                str(command),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )
        try:
            stdout, stderr = await proc.communicate(input=stdin_payload)
        except Exception:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            raise

        if proc.returncode != 0:
            logger.warning(
                "Hook script exited %s: stderr=%s",
                proc.returncode,
                (stderr or b"").decode("utf-8", errors="ignore")[:500],
            )
        else:
            logger.info(
                "Hook script ok: stdout=%s",
                (stdout or b"").decode("utf-8", errors="ignore")[:200],
            )

    async def _send_webhook(self, config: dict, payload: dict):
        """发送 HTTP webhook 回调。"""
        url = config.get("url")
        if not url:
            logger.warning("Hook webhook missing 'url'")
            return
        method = (config.get("method") or "POST").upper()
        headers = config.get("headers") or {}

        try:
            import httpx  # type: ignore
        except ImportError:  # pragma: no cover — fallback if httpx absent
            logger.error("httpx not installed; cannot send webhook")
            return

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.request(
                method=method,
                url=url,
                json=payload,
                headers=headers,
            )
            if resp.status_code >= 400:
                logger.warning(
                    "Hook webhook %s %s -> %s",
                    method, url, resp.status_code,
                )

    async def _send_notification(self, config: dict, payload: dict):
        """通过 WebSocket hub 发送通知。"""
        from backend.services.ws_hub import ws_hub
        channel = config.get("channel") or "hooks"
        event_name = payload.get("event") or "unknown"
        await ws_hub.broadcast(
            channel,
            {"type": f"hook.{event_name}", "payload": payload},
        )

    async def _invoke_skill(self, config: dict, payload: dict):
        """触发一个 Skill 对输出做后处理。"""
        skill_slug = config.get("skill_slug", "")
        if skill_slug == "security-scan":
            from backend.services.security_scanner import security_scanner
            output = payload.get("output", "")
            workspace_id = payload.get("workspace_id", "")
            task_id = payload.get("task_id", "")
            if output and workspace_id:
                findings = await security_scanner.scan_output(output, workspace_id, task_id)
                if findings:
                    logger.info("Security scan found %d issues for task %s", len(findings), task_id)
                    # 推送 critical/high 级别的实时告警
                    critical_high = [f for f in findings if f.severity in ("critical", "high")]
                    if critical_high:
                        from backend.services.ws_hub import ws_hub
                        await ws_hub.broadcast("tasks", {
                            "type": "security.alert",
                            "task_id": task_id,
                            "workspace_id": workspace_id,
                            "count": len(critical_high),
                            "findings": [
                                {"severity": f.severity, "category": f.category, "snippet": f.snippet[:100]}
                                for f in critical_high[:5]
                            ],
                        })
        else:
            logger.info("Skill invocation hook: %s (not yet implemented)", skill_slug)

    # ── CRUD helpers (used by API layer) ────────────────

    async def list_hooks(
        self,
        workspace_id: str = "default",
        event: Optional[str] = None,
        enabled: Optional[int] = None,
        project_id: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict]:
        conditions = ["workspace_id = :workspace_id"]
        params: dict = {
            "workspace_id": workspace_id,
            "limit": limit,
            "offset": offset,
        }
        if event:
            conditions.append("event = :event")
            params["event"] = event
        if enabled is not None:
            conditions.append("enabled = :enabled")
            params["enabled"] = int(bool(enabled))
        where = " AND ".join(conditions)
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT id, workspace_id, name, event, action_type, action_config,
                           conditions, project_id, priority, enabled, created_at, updated_at
                    FROM hooks
                    WHERE {where}
                    ORDER BY priority DESC, updated_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            )
            rows = result.fetchall()
        items = [self._row_to_dict(r) for r in rows]
        # project_id 提供时用 match_project_scope 在 Python 层过滤，
        # 以支持多选作用域（单项目 / JSON 数组 / 项目组 group: 前缀）。
        if project_id is not None:
            group_ids = await _get_project_group_ids(project_id)
            items = [
                it
                for it in items
                if match_project_scope(it.get("project_id"), project_id, group_ids)
            ]
        return items

    async def get_hook(self, workspace_id: str, hook_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, event, action_type, action_config,
                           conditions, project_id, priority, enabled, created_at, updated_at
                    FROM hooks
                    WHERE workspace_id = :workspace_id AND id = :id
                    """
                ),
                {"workspace_id": workspace_id, "id": hook_id},
            )
            row = result.fetchone()
        return self._row_to_dict(row) if row else None

    async def create_hook(self, workspace_id: str, data: dict) -> dict:
        name = (data.get("name") or "").strip()
        event = (data.get("event") or "").strip()
        action_type = (data.get("action_type") or "").strip()
        if not name:
            raise ValueError("Hook name is required")
        if not event:
            raise ValueError("Hook event is required")
        if not action_type:
            raise ValueError("Hook action_type is required")

        action_config = data.get("action_config")
        if action_config is None:
            raise ValueError("Hook action_config is required")

        hook_id = str(uuid.uuid4())
        now = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO hooks
                        (id, workspace_id, name, event, action_type, action_config,
                         conditions, project_id, priority, enabled, created_at, updated_at)
                    VALUES (:id, :workspace_id, :name, :event, :action_type, :action_config,
                            :conditions, :project_id, :priority, :enabled, :created_at, :updated_at)
                    """
                ),
                {
                    "id": hook_id,
                    "workspace_id": workspace_id,
                    "name": name,
                    "event": event,
                    "action_type": action_type,
                    "action_config": self._dump_json(action_config),
                    "conditions": self._dump_json(data.get("conditions")) if data.get("conditions") is not None else None,
                    "project_id": data.get("project_id") or None,
                    "priority": int(data.get("priority") or 0),
                    "enabled": int(bool(data.get("enabled", 1))),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        logger.info("Hook created: %s (%s/%s)", hook_id[:8], workspace_id, event)
        return await self.get_hook(workspace_id, hook_id)  # type: ignore[return-value]

    async def update_hook(
        self, workspace_id: str, hook_id: str, data: dict
    ) -> Optional[dict]:
        existing = await self.get_hook(workspace_id, hook_id)
        if not existing:
            return None

        sets: list[str] = []
        params: dict = {"id": hook_id, "workspace_id": workspace_id}

        if "name" in data and data["name"] is not None:
            sets.append("name = :name")
            params["name"] = data["name"]
        if "event" in data and data["event"] is not None:
            sets.append("event = :event")
            params["event"] = data["event"]
        if "action_type" in data and data["action_type"] is not None:
            sets.append("action_type = :action_type")
            params["action_type"] = data["action_type"]
        if "action_config" in data and data["action_config"] is not None:
            sets.append("action_config = :action_config")
            params["action_config"] = self._dump_json(data["action_config"])
        if "conditions" in data:
            sets.append("conditions = :conditions")
            params["conditions"] = (
                self._dump_json(data["conditions"]) if data["conditions"] is not None else None
            )
        if "project_id" in data:
            sets.append("project_id = :project_id")
            params["project_id"] = data["project_id"] or None
        if "priority" in data and data["priority"] is not None:
            sets.append("priority = :priority")
            params["priority"] = int(data["priority"])
        if "enabled" in data and data["enabled"] is not None:
            sets.append("enabled = :enabled")
            params["enabled"] = int(bool(data["enabled"]))

        if not sets:
            return existing

        sets.append("updated_at = :updated_at")
        params["updated_at"] = _now_iso()

        async with async_session_factory() as session:
            await session.execute(
                text(
                    f"UPDATE hooks SET {', '.join(sets)}"
                    " WHERE id = :id AND workspace_id = :workspace_id"
                ),
                params,
            )
            await session.commit()
        return await self.get_hook(workspace_id, hook_id)

    async def delete_hook(self, workspace_id: str, hook_id: str) -> bool:
        existing = await self.get_hook(workspace_id, hook_id)
        if not existing:
            return False
        async with async_session_factory() as session:
            await session.execute(
                text(
                    "DELETE FROM hooks"
                    " WHERE id = :id AND workspace_id = :workspace_id"
                ),
                {"id": hook_id, "workspace_id": workspace_id},
            )
            await session.commit()
        logger.info("Hook deleted: %s", hook_id[:8])
        return True

    # ── row helpers ─────────────────────────────────────

    @staticmethod
    def _row_to_dict(row) -> dict:
        r = dict(row._mapping)
        r["action_config"] = _safe_json_loads(r.get("action_config"), {})
        r["conditions"] = _safe_json_loads(r.get("conditions"), None)
        return r

    @staticmethod
    def _dump_json(value: Any) -> str:
        if isinstance(value, str):
            # 已经是字符串则按原样存（假定调用方已经序列化好）
            return value
        return json.dumps(value or {}, ensure_ascii=False)


hook_engine = HookEngine()
