"""
WorkflowService — 工作流定义 CRUD + 版本管理。

负责 workflows 表的增删改查，以及对 workflow_runs / workflow_node_runs 的查询。
工作流的实际执行调度由 WorkflowEngine 完成。
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.workflow_service")


def _safe_json_loads(raw, default):
    if raw is None or raw == "":
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


class WorkflowService:
    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    # ── workflow definition CRUD ─────────────────────────

    async def create_workflow(
        self,
        workspace_id: str,
        name: str,
        description: Optional[str],
        definition_json: dict,
    ) -> dict:
        """创建工作流定义。definition_json = React Flow 的 {nodes, edges} JSON。"""
        wf_id = str(uuid.uuid4())
        now = self._now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO workflows
                        (id, workspace_id, name, description, definition, version, created_at, updated_at)
                    VALUES (:id, :workspace_id, :name, :description, :definition, 1, :created_at, :updated_at)
                    """
                ),
                {
                    "id": wf_id,
                    "workspace_id": workspace_id,
                    "name": name,
                    "description": description,
                    "definition": json.dumps(definition_json or {"nodes": [], "edges": []}),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        logger.info("Workflow created: %s (%s)", wf_id[:8], name)
        return await self.get_workflow(wf_id)

    async def list_workflows(
        self,
        workspace_id: str = "default",
        limit: int = 50,
        offset: int = 0,
    ) -> list:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, description, definition, version,
                           created_at, updated_at
                    FROM workflows
                    WHERE workspace_id = :workspace_id
                    ORDER BY updated_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {"workspace_id": workspace_id, "limit": limit, "offset": offset},
            )
            rows = result.fetchall()
        items = []
        for row in rows:
            r = dict(row._mapping)
            r["definition"] = _safe_json_loads(r.get("definition"), {"nodes": [], "edges": []})
            items.append(r)
        return items

    async def get_workflow(self, workflow_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workspace_id, name, description, definition, version,
                           created_at, updated_at
                    FROM workflows WHERE id = :id
                    """
                ),
                {"id": workflow_id},
            )
            row = result.fetchone()
        if not row:
            return None
        r = dict(row._mapping)
        r["definition"] = _safe_json_loads(r.get("definition"), {"nodes": [], "edges": []})
        return r

    async def update_workflow(
        self,
        workflow_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        definition_json: Optional[dict] = None,
    ) -> Optional[dict]:
        existing = await self.get_workflow(workflow_id)
        if not existing:
            return None

        sets = []
        params: dict = {"id": workflow_id}

        if name is not None:
            sets.append("name = :name")
            params["name"] = name
        if description is not None:
            sets.append("description = :description")
            params["description"] = description
        if definition_json is not None:
            sets.append("definition = :definition")
            sets.append("version = version + 1")
            params["definition"] = json.dumps(definition_json)

        if not sets:
            return existing

        sets.append("updated_at = :updated_at")
        params["updated_at"] = self._now_iso()

        async with async_session_factory() as session:
            await session.execute(
                text(f"UPDATE workflows SET {', '.join(sets)} WHERE id = :id"),
                params,
            )
            await session.commit()
        return await self.get_workflow(workflow_id)

    async def delete_workflow(self, workflow_id: str) -> bool:
        existing = await self.get_workflow(workflow_id)
        if not existing:
            return False
        async with async_session_factory() as session:
            # 先删 node_runs / runs（FK 安全）
            await session.execute(
                text(
                    """
                    DELETE FROM workflow_node_runs
                    WHERE run_id IN (SELECT id FROM workflow_runs WHERE workflow_id = :id)
                    """
                ),
                {"id": workflow_id},
            )
            await session.execute(
                text("DELETE FROM workflow_runs WHERE workflow_id = :id"),
                {"id": workflow_id},
            )
            await session.execute(
                text("DELETE FROM workflows WHERE id = :id"),
                {"id": workflow_id},
            )
            await session.commit()
        logger.info("Workflow deleted: %s", workflow_id[:8])
        return True

    # ── runs query ───────────────────────────────────────

    async def get_runs(self, workflow_id: str, limit: int = 20) -> list:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, workflow_id, workspace_id, status, current_node_ids,
                           context, trigger_type, started_at, completed_at
                    FROM workflow_runs
                    WHERE workflow_id = :workflow_id
                    ORDER BY started_at DESC
                    LIMIT :limit
                    """
                ),
                {"workflow_id": workflow_id, "limit": limit},
            )
            rows = result.fetchall()
        items = []
        for row in rows:
            r = dict(row._mapping)
            r["current_node_ids"] = _safe_json_loads(r.get("current_node_ids"), [])
            r["context"] = _safe_json_loads(r.get("context"), {})
            r["node_runs"] = []
            items.append(r)
        return items

    async def get_run_detail(self, run_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            run_result = await session.execute(
                text(
                    """
                    SELECT id, workflow_id, workspace_id, status, current_node_ids,
                           context, trigger_type, started_at, completed_at
                    FROM workflow_runs WHERE id = :id
                    """
                ),
                {"id": run_id},
            )
            run_row = run_result.fetchone()
            if not run_row:
                return None

            node_result = await session.execute(
                text(
                    """
                    SELECT id, run_id, node_id, task_id, status,
                           started_at, completed_at, output, error
                    FROM workflow_node_runs
                    WHERE run_id = :run_id
                    ORDER BY COALESCE(started_at, '9999-12-31') ASC, node_id ASC
                    """
                ),
                {"run_id": run_id},
            )
            node_rows = node_result.fetchall()

        run = dict(run_row._mapping)
        run["current_node_ids"] = _safe_json_loads(run.get("current_node_ids"), [])
        run["context"] = _safe_json_loads(run.get("context"), {})
        run["node_runs"] = [dict(r._mapping) for r in node_rows]
        return run


workflow_service = WorkflowService()
