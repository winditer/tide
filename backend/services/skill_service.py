"""
SkillService — Skills 知识库 CRUD + 批量导入。

负责 ``skills`` 表的增删改查，以及为工作流 Agent 节点提供按 slug 批量获取
的接口（用于 prompt 注入）。
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import bindparam, text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.skill_service")


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
    """生成与 ECC Skills 兼容的 slug：lowercase + 连字符。"""
    value = (value or "").strip().lower()
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"[^a-z0-9\-]+", "", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "skill"


def _normalize_tags(tags) -> Optional[str]:
    """tags 既可传字符串列表也可传 JSON 字符串，统一存为 JSON。"""
    if tags is None:
        return None
    if isinstance(tags, (list, tuple)):
        return json.dumps(list(tags), ensure_ascii=False)
    if isinstance(tags, str):
        # 已经是 JSON 字符串就保留；否则按逗号拆分
        try:
            parsed = json.loads(tags)
            if isinstance(parsed, list):
                return json.dumps(parsed, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            pass
        items = [t.strip() for t in tags.split(",") if t.strip()]
        return json.dumps(items, ensure_ascii=False) if items else None
    return None


def _row_to_dict(row) -> dict:
    r = dict(row._mapping)
    r["tags"] = _safe_json_loads(r.get("tags"), [])
    return r


class SkillService:
    # ── Read ────────────────────────────────────────────

    async def list_skills(
        self,
        workspace_id: str = "default",
        category: Optional[str] = None,
        enabled_only: bool = True,
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
        if category:
            conditions.append("category = :category")
            params["category"] = category
        if enabled_only:
            conditions.append("enabled = 1")
        if project_id is not None:
            conditions.append("project_id = :project_id")
            params["project_id"] = project_id
        else:
            conditions.append("project_id IS NULL")
        where = " AND ".join(conditions)
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT id, workspace_id, name, slug, description, category,
                           tags, content, version, enabled, source, project_id,
                           created_at, updated_at
                    FROM skills
                    WHERE {where}
                    ORDER BY updated_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            )
            rows = result.fetchall()
        return [_row_to_dict(r) for r in rows]

    async def get_skill(
        self, workspace_id: str, skill_id: str
    ) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, slug, description, category,
                           tags, content, version, enabled, source, project_id,
                           created_at, updated_at
                    FROM skills
                    WHERE workspace_id = :workspace_id AND id = :id
                    """
                ),
                {"workspace_id": workspace_id, "id": skill_id},
            )
            row = result.fetchone()
        return _row_to_dict(row) if row else None

    async def get_by_slug(
        self, workspace_id: str, slug: str
    ) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, slug, description, category,
                           tags, content, version, enabled, source, project_id,
                           created_at, updated_at
                    FROM skills
                    WHERE workspace_id = :workspace_id AND slug = :slug
                    """
                ),
                {"workspace_id": workspace_id, "slug": slug},
            )
            row = result.fetchone()
        return _row_to_dict(row) if row else None

    async def get_by_slugs(
        self,
        workspace_id: str,
        slugs: list[str],
        enabled_only: bool = True,
    ) -> list[dict]:
        """按 slug 批量获取（用于 prompt 注入）。返回顺序按入参 slug 顺序保留。"""
        if not slugs:
            return []
        clean = [s for s in slugs if s]
        if not clean:
            return []
        params: dict = {"workspace_id": workspace_id, "slugs": clean}
        enabled_clause = " AND enabled = 1" if enabled_only else ""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT id, workspace_id, name, slug, description, category,
                           tags, content, version, enabled, source, project_id,
                           created_at, updated_at
                    FROM skills
                    WHERE workspace_id = :workspace_id
                      AND slug IN :slugs
                      {enabled_clause}
                    """
                ).bindparams(bindparam("slugs", expanding=True)),
                params,
            )
            rows = result.fetchall()
        items = [_row_to_dict(r) for r in rows]
        # 保持与传入 slug 顺序一致
        index = {it["slug"]: it for it in items}
        return [index[s] for s in clean if s in index]

    # ── Write ───────────────────────────────────────────

    async def get_skills_for_project(self, workspace_id: str, project_id: str) -> list[dict]:
        """加载全局 + 项目 Skills，按 slug 合并（项目覆盖全局）。"""
        async with async_session_factory() as session:
            # 1. 查询全局 skills
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, slug, description, category,
                           tags, content, version, enabled, source, project_id,
                           created_at, updated_at
                    FROM skills
                    WHERE workspace_id = :workspace_id
                      AND project_id IS NULL
                      AND enabled = 1
                    """
                ),
                {"workspace_id": workspace_id},
            )
            global_rows = result.fetchall()

            # 2. 查询项目 skills
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, slug, description, category,
                           tags, content, version, enabled, source, project_id,
                           created_at, updated_at
                    FROM skills
                    WHERE workspace_id = :workspace_id
                      AND project_id = :project_id
                      AND enabled = 1
                    """
                ),
                {"workspace_id": workspace_id, "project_id": project_id},
            )
            project_rows = result.fetchall()

        # 3. 合并：项目 skill 同 slug 覆盖全局 skill
        merged: dict[str, dict] = {}
        for r in global_rows:
            item = _row_to_dict(r)
            merged[item["slug"]] = item
        for r in project_rows:
            item = _row_to_dict(r)
            merged[item["slug"]] = item
        return list(merged.values())

    async def create_skill(
        self, workspace_id: str, data: dict
    ) -> dict:
        name = (data.get("name") or "").strip()
        if not name:
            raise ValueError("Skill name is required")
        content = data.get("content") or ""
        if not content:
            raise ValueError("Skill content is required")

        slug = (data.get("slug") or _slugify(name)).strip()
        slug = _slugify(slug)

        skill_id = str(uuid.uuid4())
        now = _now_iso()
        project_id = data.get("project_id") or None
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO skills
                        (id, workspace_id, name, slug, description, category,
                         tags, content, version, enabled, source, project_id,
                         created_at, updated_at)
                    VALUES (:id, :workspace_id, :name, :slug, :description, :category,
                            :tags, :content, 1, :enabled, :source, :project_id,
                            :created_at, :updated_at)
                    """
                ),
                {
                    "id": skill_id,
                    "workspace_id": workspace_id,
                    "name": name,
                    "slug": slug,
                    "description": data.get("description"),
                    "category": (data.get("category") or "general"),
                    "tags": _normalize_tags(data.get("tags")),
                    "content": content,
                    "enabled": int(data.get("enabled", 1) or 0),
                    "source": data.get("source") or "custom",
                    "project_id": project_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        logger.info("Skill created: %s (%s/%s)", skill_id[:8], workspace_id, slug)
        return await self.get_skill(workspace_id, skill_id)  # type: ignore[return-value]

    async def update_skill(
        self,
        workspace_id: str,
        skill_id: str,
        data: dict,
    ) -> Optional[dict]:
        existing = await self.get_skill(workspace_id, skill_id)
        if not existing:
            return None

        sets: list[str] = []
        params: dict = {"id": skill_id, "workspace_id": workspace_id}

        if "name" in data and data["name"] is not None:
            sets.append("name = :name")
            params["name"] = data["name"]
        if "slug" in data and data["slug"] is not None:
            sets.append("slug = :slug")
            params["slug"] = _slugify(data["slug"])
        if "description" in data:
            sets.append("description = :description")
            params["description"] = data["description"]
        if "category" in data and data["category"] is not None:
            sets.append("category = :category")
            params["category"] = data["category"]
        if "tags" in data:
            sets.append("tags = :tags")
            params["tags"] = _normalize_tags(data["tags"])
        if "content" in data and data["content"] is not None:
            new_content = data["content"]
            sets.append("content = :content")
            params["content"] = new_content
            if new_content != existing.get("content"):
                sets.append("version = version + 1")
        if "enabled" in data and data["enabled"] is not None:
            sets.append("enabled = :enabled")
            params["enabled"] = int(bool(data["enabled"]))
        if "source" in data and data["source"] is not None:
            sets.append("source = :source")
            params["source"] = data["source"]
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
                    f"UPDATE skills SET {', '.join(sets)}"
                    " WHERE id = :id AND workspace_id = :workspace_id"
                ),
                params,
            )
            await session.commit()
        return await self.get_skill(workspace_id, skill_id)

    async def delete_skill(
        self, workspace_id: str, skill_id: str
    ) -> bool:
        existing = await self.get_skill(workspace_id, skill_id)
        if not existing:
            return False
        async with async_session_factory() as session:
            await session.execute(
                text(
                    "DELETE FROM skills"
                    " WHERE id = :id AND workspace_id = :workspace_id"
                ),
                {"id": skill_id, "workspace_id": workspace_id},
            )
            await session.commit()
        logger.info("Skill deleted: %s", skill_id[:8])
        return True

    # ── Import / Upsert ─────────────────────────────────

    async def upsert(
        self,
        workspace_id: str,
        metadata: dict,
        content: str,
        source: str = "ecc",
    ) -> dict:
        """按 (workspace_id, slug) 唯一约束 upsert，用于批量导入。

        ``metadata`` 必须包含 ``name``，可选 ``slug`` / ``description`` /
        ``category`` / ``tags`` / ``enabled``；如果未提供 ``slug``，
        将基于 ``name`` 自动生成。
        """
        name = (metadata.get("name") or "").strip()
        if not name:
            raise ValueError("metadata.name is required")
        if not content:
            raise ValueError("content is required")

        slug = _slugify(metadata.get("slug") or name)
        existing = await self.get_by_slug(workspace_id, slug)

        payload = {
            "name": name,
            "slug": slug,
            "description": metadata.get("description"),
            "category": metadata.get("category") or "general",
            "tags": metadata.get("tags"),
            "content": content,
            "enabled": metadata.get("enabled", 1),
            "source": source,
        }

        if existing:
            updated = await self.update_skill(workspace_id, existing["id"], payload)
            return updated or existing
        return await self.create_skill(workspace_id, payload)


skill_service = SkillService()
