"""SecurityScanner — 安全扫描服务。

提供：
- ``scan_output(output, workspace_id, task_id)``：扫描文本中的安全问题。
- 安全规则 CRUD。
- 扫描结果管理（列表、忽略、汇总）。
"""

from __future__ import annotations

import re
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from backend.core.scope_utils import match_project_scope
from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.security")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class SecurityFinding:
    rule_id: str
    category: str
    severity: str
    snippet: str
    location: str  # "line X" 或 character offset
    description: str
    remediation: str


class SecurityScanner:
    """安全扫描引擎（单例）。"""

    # ── scan ─────────────────────────────────────────────

    async def scan_output(
        self, output: str, workspace_id: str, task_id: str = None, project_id: str = None
    ) -> list[SecurityFinding]:
        """扫描 Agent 输出中的安全问题。"""
        rules = await self._load_rules(workspace_id, project_id=project_id)
        findings: list[SecurityFinding] = []
        for rule in rules:
            try:
                pattern = re.compile(rule["pattern"], re.MULTILINE | re.IGNORECASE)
                for match in pattern.finditer(output):
                    # 计算行号
                    line_num = output[: match.start()].count("\n") + 1
                    findings.append(
                        SecurityFinding(
                            rule_id=rule["id"],
                            category=rule["category"],
                            severity=rule["severity"],
                            snippet=match.group()[:200],  # 截断过长匹配
                            location=f"line {line_num}",
                            description=rule["description"] or "",
                            remediation=rule["remediation"] or "",
                        )
                    )
            except re.error as e:
                logger.warning("Invalid regex in rule %s: %s", rule["id"], e)

        # 如果有 task_id，持久化 findings
        if task_id and findings:
            await self._save_findings(workspace_id, task_id, findings, project_id=project_id)

        return findings

    async def _get_project_group_ids(self, project_id: Optional[str]) -> set:
        """查询指定项目所属的所有项目组 ID 集合（用于作用域组匹配）。"""
        group_ids: set = set()
        if not project_id:
            return group_ids
        try:
            async with async_session_factory() as session:
                rows = await session.execute(
                    text(
                        "SELECT group_id FROM project_group_members WHERE project_id = :pid"
                    ),
                    {"pid": project_id},
                )
                group_ids = {r[0] for r in rows.fetchall()}
        except Exception as exc:  # noqa: BLE001 - 降级：查询失败时不做组匹配
            logger.warning("query project_group_members failed: %s", exc)
        return group_ids

    async def _load_rules(self, workspace_id: str, project_id: str = None) -> list[dict]:
        """加载启用的安全规则。

        当 project_id 提供时，加载全局规则 + 作用域匹配的项目/项目组规则，
        作用域规则同名覆盖全局规则。作用域匹配支持多选（JSON 数组）及 group: 前缀。
        """
        async with async_session_factory() as session:
            rows = (
                await session.execute(
                    text(
                        "SELECT * FROM security_rules WHERE workspace_id = :ws AND enabled = 1"
                    ),
                    {"ws": workspace_id},
                )
            ).fetchall()
        all_rules = [dict(r._mapping) for r in rows]
        if project_id:
            group_ids = await self._get_project_group_ids(project_id)
            matched = [
                rule
                for rule in all_rules
                if match_project_scope(rule.get("project_id"), project_id, group_ids)
            ]
            # 合并策略：作用域规则同名覆盖全局规则
            rules_by_name: dict[str, dict] = {}
            for rule in matched:
                name = rule.get("name", "")
                existing = rules_by_name.get(name)
                if existing is None or rule.get("project_id"):
                    rules_by_name[name] = rule
            return list(rules_by_name.values())
        # 未指定项目：仅全局规则
        return [rule for rule in all_rules if not rule.get("project_id")]

    async def _save_findings(
        self, workspace_id: str, task_id: str, findings: list[SecurityFinding], project_id: str = None
    ):
        """将扫描结果持久化。"""
        async with async_session_factory() as session:
            for f in findings:
                await session.execute(
                    text(
                        """INSERT INTO security_findings
                            (id, workspace_id, task_id, rule_id, category, severity, snippet, location, description, remediation, project_id)
                            VALUES (:id, :ws, :task_id, :rule_id, :cat, :sev, :snippet, :loc, :desc, :rem, :project_id)"""
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "ws": workspace_id,
                        "task_id": task_id,
                        "rule_id": f.rule_id,
                        "cat": f.category,
                        "sev": f.severity,
                        "snippet": f.snippet,
                        "loc": f.location,
                        "desc": f.description,
                        "rem": f.remediation,
                        "project_id": project_id,
                    },
                )
            await session.commit()

    # ── CRUD for rules ───────────────────────────────────

    async def list_rules(
        self, workspace_id: str, category: str = None, project_id: str = None
    ) -> list[dict]:
        """列出安全规则。

        指定 project_id 时返回全局规则 + 作用域匹配的项目/项目组规则；
        未指定时仅返回全局规则。作用域匹配支持多选（JSON 数组）及 group: 前缀。
        """
        conditions = ["workspace_id = :ws"]
        params: dict = {"ws": workspace_id}
        if category:
            conditions.append("category = :category")
            params["category"] = category
        where = " AND ".join(conditions)
        async with async_session_factory() as session:
            rows = (
                await session.execute(
                    text(
                        f"SELECT * FROM security_rules WHERE {where} ORDER BY category, name"
                    ),
                    params,
                )
            ).fetchall()
            items = [dict(r._mapping) for r in rows]
        if project_id:
            group_ids = await self._get_project_group_ids(project_id)
            return [
                rule
                for rule in items
                if match_project_scope(rule.get("project_id"), project_id, group_ids)
            ]
        # 未指定项目：仅全局规则
        return [rule for rule in items if not rule.get("project_id")]

    async def get_rule(self, workspace_id: str, rule_id: str) -> Optional[dict]:
        """获取单条安全规则。"""
        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT * FROM security_rules WHERE workspace_id = :ws AND id = :id"
                    ),
                    {"ws": workspace_id, "id": rule_id},
                )
            ).fetchone()
            return dict(row._mapping) if row else None

    async def create_rule(self, workspace_id: str, data: dict) -> dict:
        """创建安全规则。"""
        name = (data.get("name") or "").strip()
        category = (data.get("category") or "").strip()
        pattern = (data.get("pattern") or "").strip()
        if not name:
            raise ValueError("Rule name is required")
        if not category:
            raise ValueError("Rule category is required")
        if not pattern:
            raise ValueError("Rule pattern is required")

        # 验证正则有效性
        try:
            re.compile(pattern)
        except re.error as e:
            raise ValueError(f"Invalid regex pattern: {e}")

        rule_id = str(uuid.uuid4())
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """INSERT INTO security_rules
                        (id, workspace_id, name, category, pattern, severity, description, remediation, enabled, project_id)
                        VALUES (:id, :ws, :name, :category, :pattern, :severity, :description, :remediation, :enabled, :project_id)"""
                ),
                {
                    "id": rule_id,
                    "ws": workspace_id,
                    "name": name,
                    "category": category,
                    "pattern": pattern,
                    "severity": data.get("severity", "medium"),
                    "description": data.get("description"),
                    "remediation": data.get("remediation"),
                    "enabled": int(bool(data.get("enabled", 1))),
                    "project_id": data.get("project_id"),
                },
            )
            await session.commit()
        return await self.get_rule(workspace_id, rule_id)  # type: ignore[return-value]

    async def update_rule(
        self, workspace_id: str, rule_id: str, data: dict
    ) -> Optional[dict]:
        """更新安全规则。"""
        existing = await self.get_rule(workspace_id, rule_id)
        if not existing:
            return None

        sets: list[str] = []
        params: dict = {"id": rule_id, "ws": workspace_id}

        if "name" in data and data["name"] is not None:
            sets.append("name = :name")
            params["name"] = data["name"]
        if "category" in data and data["category"] is not None:
            sets.append("category = :category")
            params["category"] = data["category"]
        if "pattern" in data and data["pattern"] is not None:
            # 验证正则有效性
            try:
                re.compile(data["pattern"])
            except re.error as e:
                raise ValueError(f"Invalid regex pattern: {e}")
            sets.append("pattern = :pattern")
            params["pattern"] = data["pattern"]
        if "severity" in data and data["severity"] is not None:
            sets.append("severity = :severity")
            params["severity"] = data["severity"]
        if "description" in data:
            sets.append("description = :description")
            params["description"] = data["description"]
        if "remediation" in data:
            sets.append("remediation = :remediation")
            params["remediation"] = data["remediation"]
        if "enabled" in data and data["enabled"] is not None:
            sets.append("enabled = :enabled")
            params["enabled"] = int(bool(data["enabled"]))
        if "project_id" in data:
            sets.append("project_id = :project_id")
            params["project_id"] = data["project_id"]

        if not sets:
            return existing

        async with async_session_factory() as session:
            await session.execute(
                text(
                    f"UPDATE security_rules SET {', '.join(sets)}"
                    " WHERE id = :id AND workspace_id = :ws"
                ),
                params,
            )
            await session.commit()
        return await self.get_rule(workspace_id, rule_id)

    async def delete_rule(self, workspace_id: str, rule_id: str) -> bool:
        """删除安全规则。"""
        existing = await self.get_rule(workspace_id, rule_id)
        if not existing:
            return False
        async with async_session_factory() as session:
            await session.execute(
                text(
                    "DELETE FROM security_rules WHERE id = :id AND workspace_id = :ws"
                ),
                {"id": rule_id, "ws": workspace_id},
            )
            await session.commit()
        logger.info("Security rule deleted: %s", rule_id[:8])
        return True

    # ── Findings management ──────────────────────────────

    async def list_findings(
        self, workspace_id: str, task_id: str = None, status: str = None, project_id: str = None
    ) -> list[dict]:
        """列出扫描结果。"""
        conditions = ["workspace_id = :ws"]
        params: dict = {"ws": workspace_id}
        if task_id:
            conditions.append("task_id = :task_id")
            params["task_id"] = task_id
        if status:
            conditions.append("status = :status")
            params["status"] = status
        if project_id:
            conditions.append("project_id = :project_id")
            params["project_id"] = project_id
        where = " AND ".join(conditions)
        async with async_session_factory() as session:
            rows = (
                await session.execute(
                    text(
                        f"SELECT * FROM security_findings WHERE {where} ORDER BY created_at DESC"
                    ),
                    params,
                )
            ).fetchall()
            return [dict(r._mapping) for r in rows]

    async def dismiss_finding(self, finding_id: str, dismissed_by: str) -> bool:
        """忽略某个扫描发现。"""
        now = _now_iso()
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """UPDATE security_findings
                       SET status = 'dismissed', dismissed_by = :dismissed_by, dismissed_at = :dismissed_at
                       WHERE id = :id AND status = 'open'"""
                ),
                {"id": finding_id, "dismissed_by": dismissed_by, "dismissed_at": now},
            )
            await session.commit()
            return result.rowcount > 0

    async def get_findings_summary(self, workspace_id: str) -> dict:
        """获取扫描结果汇总统计。"""
        async with async_session_factory() as session:
            # 按 severity 统计 open findings
            rows = (
                await session.execute(
                    text(
                        """SELECT severity, COUNT(*) as count
                           FROM security_findings
                           WHERE workspace_id = :ws AND status = 'open'
                           GROUP BY severity"""
                    ),
                    {"ws": workspace_id},
                )
            ).fetchall()
            by_severity = {r._mapping["severity"]: r._mapping["count"] for r in rows}

            # 按 category 统计 open findings
            rows = (
                await session.execute(
                    text(
                        """SELECT category, COUNT(*) as count
                           FROM security_findings
                           WHERE workspace_id = :ws AND status = 'open'
                           GROUP BY category"""
                    ),
                    {"ws": workspace_id},
                )
            ).fetchall()
            by_category = {r._mapping["category"]: r._mapping["count"] for r in rows}

            # 总数统计
            row = (
                await session.execute(
                    text(
                        """SELECT
                            COUNT(*) as total,
                            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
                            SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed_count
                           FROM security_findings
                           WHERE workspace_id = :ws"""
                    ),
                    {"ws": workspace_id},
                )
            ).fetchone()

            return {
                "total": row._mapping["total"] or 0,
                "open": row._mapping["open_count"] or 0,
                "dismissed": row._mapping["dismissed_count"] or 0,
                "by_severity": by_severity,
                "by_category": by_category,
            }


security_scanner = SecurityScanner()
