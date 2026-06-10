"""
PlanService — Plan CRUD + DAG 解析 + 时间线聚合。

负责：
- 创建 Plan + 解析 definition 中的子任务 + 写 plan_tasks 关联
- Plan 列表 / 详情 / DAG / 时间线
- 停止 Plan / 重试子任务
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.event_emitter import event_emitter
from backend.services.plan_executor import plan_executor
from backend.services.task_service import task_service

logger = logging.getLogger("tide.plan_service")


class PlanService:
    # ── helpers ──────────────────────────────────────────

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    # ── create ───────────────────────────────────────────

    async def create_plan(
        self,
        workspace_id: str,
        definition_json: dict,
        cwd: Optional[str] = None,
        model: Optional[str] = None,
    ) -> dict:
        """
        创建 Plan + 解析 definition 中的子任务 + 写 plan_tasks 关联。
        返回 plan 字典。
        """
        plan_id = str(uuid.uuid4())
        now = self._now_iso()
        max_parallel = definition_json.get("max_parallel", 3)
        tasks_def = definition_json.get("tasks", [])

        if not cwd:
            cwd = str(Path.cwd())

        # 1. 写入 plans 表
        async with async_session_factory() as session:
            await session.execute(
                text("""
                INSERT INTO plans (id, workspace_id, cwd, model, status, max_parallel, definition, created_at)
                VALUES (:id, :workspace_id, :cwd, :model, 'active', :max_parallel, :definition, :created_at)
                """),
                {
                    "id": plan_id,
                    "workspace_id": workspace_id,
                    "cwd": cwd,
                    "model": model,
                    "max_parallel": max_parallel,
                    "definition": json.dumps(definition_json),
                    "created_at": now,
                },
            )
            await session.commit()

        # 2. 为每个子任务创建 tasks 记录 + plan_tasks 关联
        for idx, task_def in enumerate(tasks_def):
            task_id = str(uuid.uuid4())
            task_agent_id = task_def.get("agent_id", "codex")
            task_prompt = task_def.get("prompt", task_def.get("title", ""))
            task_phase = task_def.get("phase", 0)
            task_depends_on = task_def.get("depends_on", [])
            # 过滤自引用依赖（防止 task 依赖自身导致调度死锁）
            task_depends_on = [d for d in task_depends_on if d != idx]

            async with async_session_factory() as session:
                # 写 tasks 表
                await session.execute(
                    text("""
                    INSERT INTO tasks
                        (id, workspace_id, plan_id, prompt, agent_id, model, cwd, status, created_at)
                    VALUES (:id, :workspace_id, :plan_id, :prompt, :agent_id, :model, :cwd, 'queued', :created_at)
                    """),
                    {
                        "id": task_id,
                        "workspace_id": workspace_id,
                        "plan_id": plan_id,
                        "prompt": task_prompt,
                        "agent_id": task_agent_id,
                        "model": model,
                        "cwd": cwd,
                        "created_at": now,
                    },
                )
                # 写 plan_tasks 表
                await session.execute(
                    text("""
                    INSERT INTO plan_tasks (plan_id, task_id, task_index, phase, depends_on)
                    VALUES (:plan_id, :task_id, :task_index, :phase, :depends_on)
                    """),
                    {
                        "plan_id": plan_id,
                        "task_id": task_id,
                        "task_index": idx,
                        "phase": task_phase,
                        "depends_on": json.dumps(task_depends_on),
                    },
                )
                await session.commit()

        logger.info("Plan created: %s with %d tasks", plan_id[:8], len(tasks_def))

        # 启动 PlanExecutor 调度循环（无任务时立即终止；自动失败传播由 runner 处理）
        try:
            await plan_executor.start_plan(plan_id)
        except Exception:  # noqa: BLE001
            logger.exception("plan_executor.start_plan failed: %s", plan_id[:8])

        return await self.get_plan(plan_id)

    # ── list ─────────────────────────────────────────────

    async def list_plans(
        self,
        workspace_id: str = "default",
        status: Optional[str] = None,
        project: Optional[str] = None,
        session_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list:
        """列表查询。

        - ``project``: 按 ``plans.cwd`` 精确匹配。
        - ``session_id``: 按子任务 ``tasks.session_id`` 筛选（返回包含该
          session 的 plan）。
        """
        conditions = ["p.workspace_id = :workspace_id"]
        params: dict = {"workspace_id": workspace_id}

        if status:
            conditions.append("p.status = :status")
            params["status"] = status

        if project:
            conditions.append("p.cwd = :project")
            params["project"] = project

        join_clause = ""
        if session_id:
            # 通过 plan_tasks 关联到 tasks.session_id。
            # 使用 EXISTS 避免结果重复。
            conditions.append(
                "EXISTS (SELECT 1 FROM plan_tasks pt "
                "JOIN tasks t ON t.id = pt.task_id "
                "WHERE pt.plan_id = p.id AND t.session_id = :session_id)"
            )
            params["session_id"] = session_id

        where = " AND ".join(conditions)
        params["limit"] = limit
        params["offset"] = offset

        async with async_session_factory() as session:
            result = await session.execute(
                text(f"""
                SELECT p.id, p.workspace_id, p.chat_id, p.cwd, p.model, p.status,
                       p.max_parallel, p.definition, p.created_at, p.completed_at
                FROM plans p{join_clause}
                WHERE {where}
                ORDER BY p.created_at DESC
                LIMIT :limit OFFSET :offset
                """),
                params,
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]

    # ── get ──────────────────────────────────────────────

    async def get_plan(self, plan_id: str) -> Optional[dict]:
        """获取 Plan 详情"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, workspace_id, chat_id, cwd, model, status,
                       max_parallel, definition, created_at, completed_at
                FROM plans WHERE id = :plan_id
                """),
                {"plan_id": plan_id},
            )
            row = result.fetchone()
            if not row:
                return None
            return dict(row._mapping)

    # ── DAG ──────────────────────────────────────────────

    async def get_plan_dag(self, plan_id: str) -> Optional[dict]:
        """
        返回 React Flow 格式的 DAG。
        nodes: [{id, type, data: {title, status, agentId, phase}, position}]
        edges: [{id, source, target}]
        """
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT pt.task_id, pt.task_index, pt.phase, pt.depends_on,
                       t.prompt, t.status, t.agent_id
                FROM plan_tasks pt
                JOIN tasks t ON t.id = pt.task_id
                WHERE pt.plan_id = :plan_id
                ORDER BY pt.task_index
                """),
                {"plan_id": plan_id},
            )
            rows = result.fetchall()

        if not rows:
            return None

        nodes = []
        edges = []
        # Build index map: task_index -> task_id
        index_to_id = {}
        for row in rows:
            r = dict(row._mapping)
            index_to_id[r["task_index"]] = r["task_id"]

        for row in rows:
            r = dict(row._mapping)
            task_id = r["task_id"]
            phase = r["phase"] or 0
            task_index = r["task_index"]

            node = {
                "id": f"task-{task_id}",
                "type": "task",
                "data": {
                    "title": r["prompt"][:80] if r["prompt"] else "",
                    "status": r["status"],
                    "agentId": r["agent_id"],
                    "phase": phase,
                    "taskIndex": task_index,
                },
                "position": {"x": phase * 300, "y": task_index * 100},
            }
            nodes.append(node)

            # Parse depends_on edges
            depends_on_raw = r["depends_on"]
            if depends_on_raw:
                try:
                    deps = json.loads(depends_on_raw)
                except (json.JSONDecodeError, TypeError):
                    deps = []
                for dep_idx in deps:
                    source_id = index_to_id.get(dep_idx)
                    if source_id:
                        edge_id = f"e-{source_id[:8]}-{task_id[:8]}"
                        edges.append({
                            "id": edge_id,
                            "source": f"task-{source_id}",
                            "target": f"task-{task_id}",
                        })

        return {"nodes": nodes, "edges": edges}

    # ── plan tasks ───────────────────────────────────────

    async def get_plan_tasks(self, plan_id: str) -> list:
        """Plan 子任务列表，包含 phase, depends_on 信息"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT pt.task_id, pt.task_index, pt.phase, pt.depends_on,
                       t.prompt, t.status, t.agent_id
                FROM plan_tasks pt
                JOIN tasks t ON t.id = pt.task_id
                WHERE pt.plan_id = :plan_id
                ORDER BY pt.task_index
                """),
                {"plan_id": plan_id},
            )
            rows = result.fetchall()
            items = []
            for row in rows:
                r = dict(row._mapping)
                items.append({
                    "task_id": r["task_id"],
                    "task_index": r["task_index"],
                    "phase": r["phase"] or 0,
                    "depends_on": r["depends_on"],
                    "title": r["prompt"][:80] if r["prompt"] else "",
                    "status": r["status"],
                    "agent_id": r["agent_id"],
                })
            return items

    # ── timeline ─────────────────────────────────────────

    async def get_timeline(self, plan_id: str) -> list:
        """
        从 tasks 表聚合各子任务的 created_at, started_at, completed_at, duration_ms。
        返回 GanttItem 列表。
        """
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT pt.task_id, pt.phase, t.prompt, t.agent_id,
                       t.status, t.started_at, t.completed_at, t.duration_ms
                FROM plan_tasks pt
                JOIN tasks t ON t.id = pt.task_id
                WHERE pt.plan_id = :plan_id
                ORDER BY pt.task_index
                """),
                {"plan_id": plan_id},
            )
            rows = result.fetchall()
            items = []
            for row in rows:
                r = dict(row._mapping)
                items.append({
                    "task_id": r["task_id"],
                    "title": r["prompt"][:80] if r["prompt"] else "",
                    "phase": r["phase"] or 0,
                    "agent_id": r["agent_id"],
                    "start_time": r["started_at"],
                    "end_time": r["completed_at"],
                    "status": r["status"],
                    "duration_ms": r["duration_ms"],
                })
            return items

    # ── stop ─────────────────────────────────────────────

    async def stop_plan(self, plan_id: str) -> Optional[dict]:
        """停止 Plan：更新状态 + 停止所有运行中子任务"""
        plan = await self.get_plan(plan_id)
        if not plan:
            return None

        if plan["status"] not in ("active",):
            return plan

        # 让 PlanExecutor 发送停止信号，取消所有子任务 asyncio.Task
        try:
            await plan_executor.stop_plan(plan_id)
        except Exception:  # noqa: BLE001
            logger.exception("plan_executor.stop_plan failed: %s", plan_id[:8])

        # 更新 plan 状态
        now = self._now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE plans SET status = 'stopped', completed_at = :completed_at
                WHERE id = :plan_id
                """),
                {"plan_id": plan_id, "completed_at": now},
            )
            await session.commit()

        # 停止所有运行中/排队的子任务
        tasks = await self.get_plan_tasks(plan_id)
        for t in tasks:
            if t["status"] in ("queued", "running"):
                await task_service.stop_task(t["task_id"])

        logger.info("Plan stopped: %s", plan_id[:8])
        return await self.get_plan(plan_id)

    # ── retry task ───────────────────────────────────────

    async def retry_task(self, plan_id: str, task_id: str) -> Optional[dict]:
        """重试某个子任务"""
        plan = await self.get_plan(plan_id)
        if not plan:
            return None

        # 验证 task 属于该 plan
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT task_id FROM plan_tasks
                WHERE plan_id = :plan_id AND task_id = :task_id
                """),
                {"plan_id": plan_id, "task_id": task_id},
            )
            if not result.fetchone():
                return None

        # 调用 TaskService 重试（重置状态 + 启动 agent）
        result = await task_service.retry_task(task_id)

        # 确保 Plan 调度循环还在运行，这样 _runner_loop 会看到任务重新为 queued
        try:
            await plan_executor.start_plan(plan_id)
        except Exception:  # noqa: BLE001
            logger.exception("plan_executor.start_plan failed on retry: %s", plan_id[:8])

        return result

    # ── commit / merge 透传 ───────────────────

    async def approve_task(self, plan_id: str, task_id: str) -> bool:
        """审批子任务，唤醒调度循环使用 approved 模式重试。"""
        return await plan_executor.approve_task(plan_id, task_id)

    async def commit_task(self, plan_id: str, task_id: str, commit: bool) -> dict:
        """提交 / 跳过子任务的改动。"""
        return await plan_executor.commit_task(plan_id, task_id, commit)

    async def merge_task(self, plan_id: str, task_id: str) -> dict:
        """cherry-pick 合并单个子任务。"""
        ok, message = await plan_executor.merge_task(plan_id, task_id)
        return {"ok": ok, "message": message}

    async def merge_all(self, plan_id: str) -> dict:
        """合并所有 committed 子任务。"""
        merged, failed, conflicts = await plan_executor.merge_all(plan_id)
        return {
            "merged": merged,
            "failed": failed,
            "conflicts": conflicts,
        }


plan_service = PlanService()
