"""
ExpertTeamService — 专家团 CRUD + 运行时解析。

负责 ``expert_teams`` 表的增删改查，以及为工作流 Agent 节点提供运行时
专家团配置解析（agent_id / skill_slugs / role_prompt）。
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.expert_team_service")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_json_loads(raw, default):
    if raw is None or raw == "":
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


def _slugify(value: str) -> str:
    """生成 slug：lowercase + 连字符。"""
    value = (value or "").strip().lower()
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"[^a-z0-9\u4e00-\u9fff\-]+", "", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "expert-team"


def _row_to_dict(row) -> dict:
    r = dict(row._mapping)
    r["skill_slugs"] = _safe_json_loads(r.get("skill_slugs"), [])
    if "member_agents" in r:
        r["member_agents"] = _safe_json_loads(r.get("member_agents"), [])
    return r


class ExpertTeamService:
    # ── Read ────────────────────────────────────────────

    async def list_expert_teams(
        self,
        workspace_id: str = "default",
        project_id: Optional[str] = None,
        enabled: Optional[int] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict]:
        conditions = ["workspace_id = :workspace_id"]
        params: dict = {
            "workspace_id": workspace_id,
            "limit": limit,
            "offset": offset,
        }
        if project_id is not None:
            conditions.append("(project_id = :project_id OR project_id IS NULL)")
            params["project_id"] = project_id
        if enabled is not None:
            conditions.append("enabled = :enabled")
            params["enabled"] = enabled
        where = " AND ".join(conditions)
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT id, workspace_id, project_id, name, slug, description,
                           agent_id, model, skill_slugs, role_prompt,
                           member_agents, is_squad, leader_strategy, enabled,
                           created_at, updated_at
                    FROM expert_teams
                    WHERE {where}
                    ORDER BY updated_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            )
            rows = result.fetchall()
        return [_row_to_dict(r) for r in rows]

    async def get_expert_teams_for_project(
        self, workspace_id: str, project_id: str
    ) -> list[dict]:
        """加载全局 + 项目专家团，按 slug 合并（项目覆盖全局）。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, project_id, name, slug, description,
                           agent_id, model, skill_slugs, role_prompt,
                           member_agents, is_squad, leader_strategy, enabled,
                           created_at, updated_at
                    FROM expert_teams
                    WHERE workspace_id = :workspace_id
                      AND (project_id = :project_id OR project_id IS NULL)
                      AND enabled = 1
                    ORDER BY project_id ASC
                    """
                ),
                {"workspace_id": workspace_id, "project_id": project_id},
            )
            rows = result.fetchall()
        items = [_row_to_dict(r) for r in rows]
        # 按 slug 合并：项目级覆盖全局级（project_id IS NULL 排前面）
        merged: dict[str, dict] = {}
        for item in items:
            merged[item["slug"]] = item
        return list(merged.values())

    async def get_expert_team(self, team_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, project_id, name, slug, description,
                           agent_id, model, skill_slugs, role_prompt,
                           member_agents, is_squad, leader_strategy, enabled,
                           created_at, updated_at
                    FROM expert_teams
                    WHERE id = :id
                    """
                ),
                {"id": team_id},
            )
            row = result.fetchone()
        return _row_to_dict(row) if row else None

    async def resolve_expert_team(
        self, team_id: str, workspace_id: str
    ) -> Optional[dict]:
        """运行时解析：返回 dict 包含 agent_id, model, skill_slugs, role_prompt。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT agent_id, model, skill_slugs, role_prompt
                    FROM expert_teams
                    WHERE id = :id AND workspace_id = :workspace_id AND enabled = 1
                    """
                ),
                {"id": team_id, "workspace_id": workspace_id},
            )
            row = result.fetchone()
        if not row:
            return None
        mapping = dict(row._mapping)
        mapping["skill_slugs"] = _safe_json_loads(mapping.get("skill_slugs"), [])
        return mapping

    async def resolve_squad(
        self, team_id: str, workspace_id: str
    ) -> Optional[dict]:
        """运行时解析：支持 Squad 多 Agent 选择。

        - is_squad=0 的普通专家团：退化为原 resolve_expert_team() 行为
        - is_squad=1 的 Squad：按 leader_strategy 从 member_agents 中选择一个成员

        返回 dict: {agent_id, model, skill_slugs, role_prompt}（结构与 resolve_expert_team 一致）
        """
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT agent_id, model, skill_slugs, role_prompt,
                           member_agents, is_squad, leader_strategy
                    FROM expert_teams
                    WHERE id = :id AND workspace_id = :workspace_id AND enabled = 1
                    """
                ),
                {"id": team_id, "workspace_id": workspace_id},
            )
            row = result.fetchone()
        if not row:
            return None
        mapping = dict(row._mapping)
        mapping["skill_slugs"] = _safe_json_loads(mapping.get("skill_slugs"), [])

        # 非 Squad 团队：直接返回（兼容原行为）
        if not mapping.get("is_squad"):
            return {
                "agent_id": mapping["agent_id"],
                "model": mapping.get("model"),
                "skill_slugs": mapping["skill_slugs"],
                "role_prompt": mapping.get("role_prompt"),
            }

        # Squad 模式：从 member_agents 中按策略选择
        member_agents = _safe_json_loads(mapping.get("member_agents"), [])
        if not member_agents:
            # 空成员列表，fallback 到主 agent_id
            logger.warning("Squad %s has empty member_agents, falling back to primary agent_id", team_id)
            return {
                "agent_id": mapping["agent_id"],
                "model": mapping.get("model"),
                "skill_slugs": mapping["skill_slugs"],
                "role_prompt": mapping.get("role_prompt"),
            }

        # 按策略选择成员
        selected = self._select_squad_member(member_agents, mapping.get("leader_strategy", "capability_match"))

        return {
            "agent_id": selected.get("agent_id", mapping["agent_id"]),
            "model": selected.get("model") or mapping.get("model"),
            "skill_slugs": selected.get("skill_slugs") or mapping["skill_slugs"],
            "role_prompt": selected.get("role_prompt") or mapping.get("role_prompt"),
        }

    def _select_squad_member(self, members: list, strategy: str) -> dict:
        """根据策略从 Squad 成员中选择一个。

        members: [{agent_id, role, skill_slugs, capability_tags, priority}, ...]
        strategy: capability_match | round_robin | random
        """
        if not members:
            return {}

        if strategy == "random":
            import random
            return random.choice(members)
        elif strategy == "round_robin":
            # 简单轮转：基于当前时间戳取模
            import time
            idx = int(time.time()) % len(members)
            return members[idx]
        else:
            # capability_match 或未知策略：默认选优先级最高的成员
            sorted_members = sorted(members, key=lambda m: m.get("priority", 0), reverse=True)
            return sorted_members[0]

    # ── Squad Dispatch (no-workflow 协作) ───────────────

    async def get_squad_leader_for_dispatch(self, team_id: str) -> Optional[dict]:
        """解析 squad leader：根据 leader_strategy 选出主调度者。

        Returns:
            {agent_id, member_info, strategy_used} or None if team not found/not a squad
        """
        team = await self.get_expert_team(team_id)
        if not team:
            return None
        if not team.get("is_squad"):
            return None

        member_agents = team.get("member_agents") or []
        if not member_agents:
            logger.warning(
                "Squad %s has empty member_agents, cannot resolve leader", team_id
            )
            return None

        strategy = team.get("leader_strategy") or "capability_match"
        leader = self._select_squad_member(member_agents, strategy)
        if not leader:
            return None

        return {
            "agent_id": leader.get("agent_id"),
            "member_info": leader,
            "strategy_used": strategy,
        }

    async def get_squad_members(self, team_id: str) -> list:
        """获取 squad 所有成员列表（含角色和能力标签）。

        Returns:
            [{agent_id, role, skill_slugs, capability_tags, priority}, ...]
        """
        team = await self.get_expert_team(team_id)
        if not team:
            return []
        return team.get("member_agents") or []

    async def validate_member_in_squad(self, team_id: str, member_id: str) -> bool:
        """验证某成员是否属于指定 squad。"""
        members = await self.get_squad_members(team_id)
        return any(m.get("agent_id") == member_id for m in members)

    # ── Write ───────────────────────────────────────────

    async def create_expert_team(
        self, workspace_id: str, data: dict
    ) -> dict:
        name = (data.get("name") or "").strip()
        if not name:
            raise ValueError("Expert team name is required")

        agent_id = (data.get("agent_id") or "").strip()
        if not agent_id:
            raise ValueError("agent_id is required")

        slug = (data.get("slug") or _slugify(name)).strip()
        slug = _slugify(slug)

        skill_slugs = data.get("skill_slugs") or []
        if isinstance(skill_slugs, list):
            skill_slugs_json = json.dumps(skill_slugs, ensure_ascii=False)
        else:
            skill_slugs_json = json.dumps([], ensure_ascii=False)

        member_agents = data.get("member_agents") or []
        if isinstance(member_agents, list):
            member_agents_json = json.dumps(member_agents, ensure_ascii=False)
        else:
            member_agents_json = json.dumps([], ensure_ascii=False)

        team_id = str(uuid.uuid4())
        now = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO expert_teams
                        (id, workspace_id, project_id, name, slug, description,
                         agent_id, model, skill_slugs, role_prompt,
                         member_agents, is_squad, leader_strategy, enabled,
                         created_at, updated_at)
                    VALUES (:id, :workspace_id, :project_id, :name, :slug, :description,
                            :agent_id, :model, :skill_slugs, :role_prompt,
                            :member_agents, :is_squad, :leader_strategy, :enabled,
                            :created_at, :updated_at)
                    """
                ),
                {
                    "id": team_id,
                    "workspace_id": workspace_id,
                    "name": name,
                    "slug": slug,
                    "project_id": data.get("project_id") or None,
                    "description": data.get("description"),
                    "agent_id": agent_id,
                    "model": data.get("model") or None,
                    "skill_slugs": skill_slugs_json,
                    "role_prompt": data.get("role_prompt"),
                    "member_agents": member_agents_json,
                    "is_squad": int(data.get("is_squad", 0) or 0),
                    "leader_strategy": data.get("leader_strategy") or "capability_match",
                    "enabled": int(data.get("enabled", 1) or 0),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        logger.info("Expert team created: %s (%s/%s)", team_id[:8], workspace_id, slug)
        return await self.get_expert_team(team_id)  # type: ignore[return-value]

    async def update_expert_team(
        self, team_id: str, data: dict
    ) -> Optional[dict]:
        existing = await self.get_expert_team(team_id)
        if not existing:
            return None

        sets: list[str] = []
        params: dict = {"id": team_id}

        if "name" in data and data["name"] is not None:
            sets.append("name = :name")
            params["name"] = data["name"]
        if "description" in data:
            sets.append("description = :description")
            params["description"] = data["description"]
        if "agent_id" in data and data["agent_id"] is not None:
            sets.append("agent_id = :agent_id")
            params["agent_id"] = data["agent_id"]
        if "model" in data:
            sets.append("model = :model")
            params["model"] = data["model"] or None
        if "skill_slugs" in data:
            sets.append("skill_slugs = :skill_slugs")
            skill_slugs = data["skill_slugs"] or []
            if isinstance(skill_slugs, list):
                params["skill_slugs"] = json.dumps(skill_slugs, ensure_ascii=False)
            else:
                params["skill_slugs"] = json.dumps([], ensure_ascii=False)
        if "role_prompt" in data:
            sets.append("role_prompt = :role_prompt")
            params["role_prompt"] = data["role_prompt"]
        if "member_agents" in data:
            sets.append("member_agents = :member_agents")
            member_agents = data["member_agents"] or []
            if isinstance(member_agents, list):
                params["member_agents"] = json.dumps(member_agents, ensure_ascii=False)
            else:
                params["member_agents"] = json.dumps([], ensure_ascii=False)
        if "is_squad" in data and data["is_squad"] is not None:
            sets.append("is_squad = :is_squad")
            params["is_squad"] = int(data["is_squad"])
        if "leader_strategy" in data and data["leader_strategy"] is not None:
            sets.append("leader_strategy = :leader_strategy")
            params["leader_strategy"] = data["leader_strategy"]
        if "enabled" in data and data["enabled"] is not None:
            sets.append("enabled = :enabled")
            params["enabled"] = int(data["enabled"])
        if "project_id" in data:
            sets.append("project_id = :project_id")
            params["project_id"] = data["project_id"] or None

        if not sets:
            return existing

        sets.append("updated_at = :updated_at")
        params["updated_at"] = _now_iso()

        async with async_session_factory() as session:
            await session.execute(
                text(
                    f"UPDATE expert_teams SET {', '.join(sets)} WHERE id = :id"
                ),
                params,
            )
            await session.commit()
        return await self.get_expert_team(team_id)

    async def delete_expert_team(self, team_id: str) -> bool:
        existing = await self.get_expert_team(team_id)
        if not existing:
            return False
        async with async_session_factory() as session:
            await session.execute(
                text("DELETE FROM expert_teams WHERE id = :id"),
                {"id": team_id},
            )
            await session.commit()
        logger.info("Expert team deleted: %s", team_id[:8])
        return True


expert_team_service = ExpertTeamService()
