"""
RuleService — Rules 规则引擎 CRUD + 分层匹配。

负责 ``rules`` 表的增删改查，以及为工作流 Agent 节点提供按 cwd / project
匹配的规则集合（用于 prompt 注入）。

分层加载顺序：global → language（根据 cwd 文件扩展名推断）→ project。
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from backend.core.scope_utils import match_project_scope
from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.rule_service")


# ── 语言扩展名映射 ──────────────────────────────────────────
LANG_EXT_MAP: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "typescript",
    ".jsx": "typescript",
    ".go": "golang",
    ".rs": "rust",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _row_to_dict(row) -> dict:
    return dict(row._mapping)


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


def _detect_language(cwd: str) -> Optional[str]:
    """根据 cwd 目录下文件的主要扩展名推断语言。

    简单策略：扫描第一层文件（不递归）统计扩展名频次，取最高频对应的语言。
    若没有匹配的扩展名则返回 None（不加载 language 规则）。
    """
    if not cwd or not os.path.isdir(cwd):
        return None
    counts: dict[str, int] = {}
    try:
        for name in os.listdir(cwd):
            full = os.path.join(cwd, name)
            if not os.path.isfile(full):
                continue
            ext = os.path.splitext(name)[1].lower()
            lang = LANG_EXT_MAP.get(ext)
            if not lang:
                continue
            counts[lang] = counts.get(lang, 0) + 1
    except OSError:
        return None
    if not counts:
        return None
    # 取频次最高的语言
    return max(counts.items(), key=lambda x: x[1])[0]


class RuleService:
    # ── Read ────────────────────────────────────────────

    async def list_rules(
        self,
        workspace_id: str,
        scope: Optional[str] = None,
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
        if scope:
            conditions.append("scope = :scope")
            params["scope"] = scope
        where = " AND ".join(conditions)
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT id, workspace_id, name, scope, scope_value, project_id,
                           content, priority, enabled, source, created_at, updated_at
                    FROM rules
                    WHERE {where}
                    ORDER BY priority DESC, created_at ASC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            )
            rows = result.fetchall()
        items = [_row_to_dict(r) for r in rows]
        # project_id 提供时用 match_project_scope 在 Python 层过滤，
        # 以支持多选作用域（单项目 / JSON 数组 / 项目组 group: 前缀）。
        if project_id:
            group_ids = await _get_project_group_ids(project_id)
            items = [
                it
                for it in items
                if match_project_scope(it.get("project_id"), project_id, group_ids)
            ]
        return items

    async def get_rule(self, workspace_id: str, rule_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, scope, scope_value, project_id,
                           content, priority, enabled, source, created_at, updated_at
                    FROM rules
                    WHERE workspace_id = :workspace_id AND id = :rule_id
                    """
                ),
                {"workspace_id": workspace_id, "rule_id": rule_id},
            )
            row = result.fetchone()
        return _row_to_dict(row) if row else None

    async def get_matching_rules(
        self,
        workspace_id: str,
        cwd: str,
        project_id: Optional[str] = None,
    ) -> list[dict]:
        """获取匹配 cwd / project_id 的规则集合。

        加载顺序：global → language（根据 cwd 推断）→ project。
        仅返回 enabled=1 的规则，按 priority DESC 排序（同 priority 按 scope 顺序保持稳定）。
        """
        language = _detect_language(cwd)

        # scope -> 排序权重，global=0, language=1, project=2（用于稳定排序）
        scope_order = {"global": 0, "language": 1, "project": 2}

        async with async_session_factory() as session:
            # 1. global 规则
            r_global = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, scope, scope_value, project_id,
                           content, priority, enabled, source, created_at, updated_at
                    FROM rules
                    WHERE workspace_id = :workspace_id
                      AND scope = 'global'
                      AND enabled = 1
                    """
                ),
                {"workspace_id": workspace_id},
            )
            global_rows = [_row_to_dict(r) for r in r_global.fetchall()]

            # 2. language 规则（仅当成功推断出语言时）
            lang_rows: list[dict] = []
            if language:
                r_lang = await session.execute(
                    text(
                        """
                        SELECT id, workspace_id, name, scope, scope_value, project_id,
                               content, priority, enabled, source, created_at, updated_at
                        FROM rules
                        WHERE workspace_id = :workspace_id
                          AND scope = 'language'
                          AND scope_value = :language
                          AND enabled = 1
                        """
                    ),
                    {"workspace_id": workspace_id, "language": language},
                )
                lang_rows = [_row_to_dict(r) for r in r_lang.fetchall()]

            # 3. project 规则
            project_rows: list[dict] = []
            if project_id:
                r_proj = await session.execute(
                    text(
                        """
                        SELECT id, workspace_id, name, scope, scope_value, project_id,
                               content, priority, enabled, source, created_at, updated_at
                        FROM rules
                        WHERE workspace_id = :workspace_id
                          AND scope = 'project'
                          AND project_id = :project_id
                          AND enabled = 1
                        """
                    ),
                    {"workspace_id": workspace_id, "project_id": project_id},
                )
                project_rows = [_row_to_dict(r) for r in r_proj.fetchall()]

        merged = global_rows + lang_rows + project_rows
        # 按 priority DESC，其次按层级顺序（global → language → project）稳定排序
        merged.sort(
            key=lambda r: (
                -int(r.get("priority") or 0),
                scope_order.get(str(r.get("scope") or "global"), 99),
            )
        )
        return merged

    # ── Write ───────────────────────────────────────────

    async def create_rule(self, workspace_id: str, data: dict) -> Optional[dict]:
        name = (data.get("name") or "").strip()
        content = data.get("content") or ""
        if not name:
            raise ValueError("name is required")
        if not content:
            raise ValueError("content is required")
        scope = (data.get("scope") or "global").strip() or "global"
        scope_value = data.get("scope_value")
        project_id = data.get("project_id")
        priority = int(data.get("priority") or 0)
        enabled = int(data.get("enabled") if data.get("enabled") is not None else 1)
        source = (data.get("source") or "custom").strip() or "custom"

        rule_id = str(uuid.uuid4())
        now = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO rules
                        (id, workspace_id, name, scope, scope_value, project_id,
                         content, priority, enabled, source, created_at, updated_at)
                    VALUES (:id, :workspace_id, :name, :scope, :scope_value, :project_id,
                            :content, :priority, :enabled, :source, :created_at, :updated_at)
                    """
                ),
                {
                    "id": rule_id,
                    "workspace_id": workspace_id,
                    "name": name,
                    "scope": scope,
                    "scope_value": scope_value,
                    "project_id": project_id,
                    "content": content,
                    "priority": priority,
                    "enabled": enabled,
                    "source": source,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        logger.info("Rule created: %s (%s, scope=%s)", rule_id[:8], name, scope)
        return await self.get_rule(workspace_id, rule_id)

    async def update_rule(
        self,
        workspace_id: str,
        rule_id: str,
        data: dict,
    ) -> Optional[dict]:
        existing = await self.get_rule(workspace_id, rule_id)
        if not existing:
            return None

        allowed = {
            "name",
            "scope",
            "scope_value",
            "project_id",
            "content",
            "priority",
            "enabled",
            "source",
        }
        updates: dict = {}
        for k, v in data.items():
            if k not in allowed:
                continue
            if k in ("priority", "enabled") and v is not None:
                updates[k] = int(v)
            else:
                updates[k] = v
        if not updates:
            return existing

        updates["updated_at"] = _now_iso()
        set_clause = ", ".join(f"{k} = :{k}" for k in updates.keys())
        params = {**updates, "workspace_id": workspace_id, "rule_id": rule_id}
        async with async_session_factory() as session:
            await session.execute(
                text(
                    f"""
                    UPDATE rules
                    SET {set_clause}
                    WHERE workspace_id = :workspace_id AND id = :rule_id
                    """
                ),
                params,
            )
            await session.commit()
        return await self.get_rule(workspace_id, rule_id)

    async def delete_rule(self, workspace_id: str, rule_id: str) -> bool:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    DELETE FROM rules
                    WHERE workspace_id = :workspace_id AND id = :rule_id
                    """
                ),
                {"workspace_id": workspace_id, "rule_id": rule_id},
            )
            await session.commit()
        return (result.rowcount or 0) > 0


rule_service = RuleService()
