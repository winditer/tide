"""Agent 配置覆盖层服务。

管理 ``agent_configs`` 表，支持全局 / 项目 / 个人三级作用域的配置覆盖。
运行时按优先级合并：personal > project > global > 默认配置。
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.agent_config_service")

_VALID_SCOPES = {"global", "project", "personal"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> Optional[dict]:
    if row is None:
        return None
    d = dict(row._mapping)
    # 解析 config_json
    raw = d.get("config_json")
    if raw:
        try:
            d["config_json"] = json.loads(raw)
        except (TypeError, ValueError):
            d["config_json"] = {}
    else:
        d["config_json"] = {}
    return d


class AgentConfigService:
    """Agent 配置覆盖层 CRUD + 运行时合并。"""

    # ------------------------------------------------------------------ list

    async def list_configs(
        self,
        workspace_id: str = "default",
        scope: Optional[str] = None,
        scope_target: Optional[str] = None,
        agent_id: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict]:
        """按条件查询 agent_configs 列表。"""
        conditions = ["ac.workspace_id = :workspace_id"]
        params: dict[str, Any] = {
            "workspace_id": workspace_id,
            "limit": limit,
            "offset": offset,
        }
        if scope is not None:
            conditions.append("ac.scope = :scope")
            params["scope"] = scope
        if scope_target is not None:
            conditions.append("ac.scope_target = :scope_target")
            params["scope_target"] = scope_target
        if agent_id is not None:
            conditions.append("ac.agent_id = :agent_id")
            params["agent_id"] = agent_id

        where = " AND ".join(conditions)
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT ac.id, ac.workspace_id, ac.agent_id, ac.scope, ac.scope_target,
                           ac.enabled, ac.display_name, ac.description,
                           ac.model_override, ac.timeout_override, ac.config_json,
                           ac.created_by,
                           COALESCE(u.display_name, u.username, ac.created_by) AS created_by_name,
                           ac.created_at, ac.updated_at
                    FROM agent_configs ac
                    LEFT JOIN users u ON ac.created_by = u.id
                    WHERE {where}
                    ORDER BY ac.scope ASC, ac.agent_id ASC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            )
            rows = result.fetchall()
        return [_row_to_dict(r) for r in rows]

    # ----------------------------------------------------------------- get

    async def get_config(self, config_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, agent_id, scope, scope_target,
                           enabled, display_name, description,
                           model_override, timeout_override, config_json,
                           created_by, created_at, updated_at
                    FROM agent_configs
                    WHERE id = :id
                    """
                ),
                {"id": config_id},
            )
            row = result.fetchone()
        return _row_to_dict(row)

    # -------------------------------------------------------------- create

    async def create_config(
        self,
        workspace_id: str = "default",
        data: Optional[dict] = None,
    ) -> dict:
        """创建 Agent 配置记录。"""
        if not data:
            raise ValueError("data is required")

        agent_id = (data.get("agent_id") or "").strip()
        scope = (data.get("scope") or "global").strip()
        scope_target = (data.get("scope_target") or "").strip() or None

        if not agent_id:
            raise ValueError("agent_id is required")
        if scope not in _VALID_SCOPES:
            raise ValueError(f"Invalid scope: {scope}, must be one of {_VALID_SCOPES}")

        config_id = str(uuid.uuid4())
        now = _now_iso()

        config_json_raw = data.get("config_json")
        if isinstance(config_json_raw, dict):
            config_json_str = json.dumps(config_json_raw, ensure_ascii=False)
        elif isinstance(config_json_raw, str):
            config_json_str = config_json_raw
        else:
            config_json_str = None

        # 先按自然键（workspace_id, agent_id, scope, scope_target）查重。
        # 注意：SQLite 的 UNIQUE 约束对 NULL 视为互不相同，因此 global 作用域
        # （scope_target 为 NULL）需显式用 IS NULL 匹配，既避免重复报错，
        # 也避免产生重复的全局配置行。
        async with async_session_factory() as session:
            if scope_target is None:
                dup = await session.execute(
                    text(
                        "SELECT id FROM agent_configs "
                        "WHERE workspace_id = :w AND agent_id = :a "
                        "AND scope = :s AND scope_target IS NULL"
                    ),
                    {"w": workspace_id, "a": agent_id, "s": scope},
                )
            else:
                dup = await session.execute(
                    text(
                        "SELECT id FROM agent_configs "
                        "WHERE workspace_id = :w AND agent_id = :a "
                        "AND scope = :s AND scope_target = :t"
                    ),
                    {"w": workspace_id, "a": agent_id, "s": scope, "t": scope_target},
                )
            existing_row = dup.fetchone()

        # 已存在相同作用域配置：改为更新（UPSERT 语义），避免触发唯一约束报错。
        if existing_row is not None:
            existing_id = existing_row[0]
            update_payload: dict[str, Any] = {}
            for key in (
                "enabled",
                "display_name",
                "description",
                "model_override",
                "timeout_override",
            ):
                if key in data:
                    update_payload[key] = data[key]
            if config_json_str is not None:
                update_payload["config_json"] = config_json_str
            updated = await self.update_config(existing_id, update_payload)
            if updated:
                return updated
            return await self.get_config(existing_id)  # type: ignore[return-value]

        async with async_session_factory() as session:
            try:
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_configs
                            (id, workspace_id, agent_id, scope, scope_target,
                             enabled, display_name, description,
                             model_override, timeout_override, config_json,
                             created_by, created_at, updated_at)
                        VALUES
                            (:id, :workspace_id, :agent_id, :scope, :scope_target,
                             :enabled, :display_name, :description,
                             :model_override, :timeout_override, :config_json,
                             :created_by, :created_at, :updated_at)
                        """
                    ),
                    {
                        "id": config_id,
                        "workspace_id": workspace_id,
                        "agent_id": agent_id,
                        "scope": scope,
                        "scope_target": scope_target,
                        "enabled": int(data.get("enabled", 1)),
                        "display_name": data.get("display_name"),
                        "description": data.get("description"),
                        "model_override": data.get("model_override"),
                        "timeout_override": data.get("timeout_override"),
                        "config_json": config_json_str,
                        "created_by": data.get("created_by"),
                        "created_at": now,
                        "updated_at": now,
                    },
                )
                await session.commit()
            except Exception as exc:  # noqa: BLE001
                emsg = str(exc).lower()
                if "unique" in emsg or "constraint" in emsg:
                    raise ValueError(
                        "相同作用域下已存在该 Agent 的配置，无法重复创建"
                    ) from exc
                raise

        return await self.get_config(config_id)  # type: ignore[return-value]

    # -------------------------------------------------------------- update

    async def update_config(self, config_id: str, data: dict) -> Optional[dict]:
        """更新 Agent 配置记录。"""
        existing = await self.get_config(config_id)
        if not existing:
            return None

        sets: list[str] = []
        params: dict[str, Any] = {"id": config_id}

        field_map = {
            "enabled": "enabled",
            "display_name": "display_name",
            "description": "description",
            "model_override": "model_override",
            "timeout_override": "timeout_override",
            "scope": "scope",
            "scope_target": "scope_target",
        }

        for field, col in field_map.items():
            if field in data:
                value = data[field]
                if field == "scope" and value not in _VALID_SCOPES:
                    raise ValueError(f"Invalid scope: {value}")
                if field == "scope_target" and not value:
                    value = None
                sets.append(f"{col} = :{col}")
                params[col] = value

        if "config_json" in data:
            raw = data["config_json"]
            if isinstance(raw, dict):
                raw = json.dumps(raw, ensure_ascii=False)
            sets.append("config_json = :config_json")
            params["config_json"] = raw

        if not sets:
            return existing

        now = _now_iso()
        sets.append("updated_at = :updated_at")
        params["updated_at"] = now

        async with async_session_factory() as session:
            try:
                await session.execute(
                    text(f"UPDATE agent_configs SET {', '.join(sets)} WHERE id = :id"),
                    params,
                )
                await session.commit()
            except Exception as exc:  # noqa: BLE001
                msg = str(exc).lower()
                if "unique" in msg or "constraint" in msg:
                    raise ValueError(
                        "相同作用域下已存在该 Agent 的配置，无法重复设置，请先删除原有配置或选择其他作用域"
                    ) from exc
                raise

        return await self.get_config(config_id)

    # ------------------------------------------------------------- toggle

    async def toggle_enabled(self, config_id: str, enabled: int) -> Optional[dict]:
        """切换 enabled 状态。"""
        return await self.update_config(config_id, {"enabled": enabled})

    # ------------------------------------------------------------ delete

    async def delete_config(self, config_id: str) -> bool:
        async with async_session_factory() as session:
            result = await session.execute(
                text("DELETE FROM agent_configs WHERE id = :id"),
                {"id": config_id},
            )
            await session.commit()
        return (result.rowcount or 0) > 0

    # ----------------------------------------------------------- resolve

    async def resolve_configs(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        workspace_id: str = "default",
    ) -> dict[str, dict]:
        """按优先级合并配置：personal > project > global。

        返回 ``{agent_id: merged_config}`` 字典。
        """
        # 加载三层配置
        global_configs = await self.list_configs(
            workspace_id=workspace_id, scope="global", limit=500
        )
        project_configs: list[dict] = []
        personal_configs: list[dict] = []

        if project_id:
            project_configs = await self.list_configs(
                workspace_id=workspace_id,
                scope="project",
                scope_target=project_id,
                limit=500,
            )
        if user_id:
            personal_configs = await self.list_configs(
                workspace_id=workspace_id,
                scope="personal",
                scope_target=user_id,
                limit=500,
            )

        # 按 agent_id 合并：后加载的覆盖先加载的（优先级递增）
        merged: dict[str, dict] = {}
        for cfg in global_configs:
            merged[cfg["agent_id"]] = cfg
        for cfg in project_configs:
            merged[cfg["agent_id"]] = cfg
        for cfg in personal_configs:
            merged[cfg["agent_id"]] = cfg

        return merged


# 模块级单例
agent_config_service = AgentConfigService()
