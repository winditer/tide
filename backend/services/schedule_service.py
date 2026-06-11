"""
ScheduleService — 定时任务调度管理。

使用 APScheduler AsyncIOScheduler，Schedule 元数据持久化在 SQLite schedules 表。
服务启动时从 DB 恢复所有 enabled 的 Schedule。
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.event_emitter import event_emitter
from backend.services.ws_hub import ws_hub

logger = logging.getLogger("tide.schedule_service")


class ScheduleService:
    def __init__(self):
        self.scheduler = None  # AsyncIOScheduler 实例

    async def start(self):
        """初始化 APScheduler + 从 DB 恢复所有 enabled 的 Schedule"""
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        self.scheduler = AsyncIOScheduler()
        self.scheduler.start()
        await self._restore_schedules()
        logger.info("ScheduleService started")

    async def shutdown(self):
        """关闭调度器"""
        if self.scheduler:
            self.scheduler.shutdown(wait=False)
            logger.info("ScheduleService shutdown")

    async def _restore_schedules(self):
        """从 DB 读取所有 enabled=1 的 schedule，注册到 APScheduler"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("SELECT * FROM schedules WHERE enabled = 1")
            )
            rows = result.fetchall()

        restored = 0
        for row in rows:
            schedule = dict(row._mapping)
            try:
                trigger = self._build_trigger(
                    schedule["trigger_type"],
                    json.loads(schedule["trigger_config"]),
                )
                self.scheduler.add_job(
                    self._execute_scheduled_task,
                    trigger=trigger,
                    id=schedule["id"],
                    args=[schedule["id"]],
                    replace_existing=True,
                )
                restored += 1
            except Exception as exc:
                logger.warning(
                    "Failed to restore schedule %s: %s", schedule["id"][:8], exc
                )

        logger.info("Restored %d schedules from DB", restored)

    # ── CRUD ─────────────────────────────────────────────

    async def create_schedule(
        self,
        workspace_id: str,
        name: str,
        description: str,
        trigger_type: str,
        trigger_config: dict,
        task_type: str,
        task_config: dict,
    ) -> dict:
        """
        写入 schedules 表 + 注册到 APScheduler。

        trigger_type: 'cron' | 'interval' | 'date'
        trigger_config: JSON 对象
            cron: {"cron": "0 9 * * 1-5", "timezone": "Asia/Shanghai"}
            interval: {"seconds": 1800}
            date: {"run_at": "2026-06-10T09:00:00+08:00"}
        task_type: 'agent' | 'plan' | 'status' | 'custom'
        task_config: JSON 对象
            agent: {"prompt": "...", "agent_id": "claude", "model": "...", "cwd": "..."}
        """
        schedule_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        # Build trigger to validate config before persisting
        trigger = self._build_trigger(trigger_type, trigger_config)

        async with async_session_factory() as session:
            await session.execute(
                text("""
                INSERT INTO schedules
                    (id, workspace_id, name, description, trigger_type,
                     trigger_config, task_type, task_config, enabled,
                     run_count, created_at, updated_at)
                VALUES
                    (:id, :workspace_id, :name, :description, :trigger_type,
                     :trigger_config, :task_type, :task_config, 1,
                     0, :created_at, :updated_at)
                """),
                {
                    "id": schedule_id,
                    "workspace_id": workspace_id,
                    "name": name,
                    "description": description or "",
                    "trigger_type": trigger_type,
                    "trigger_config": json.dumps(trigger_config),
                    "task_type": task_type,
                    "task_config": json.dumps(task_config),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        # Register with APScheduler
        self.scheduler.add_job(
            self._execute_scheduled_task,
            trigger=trigger,
            id=schedule_id,
            args=[schedule_id],
            replace_existing=True,
        )

        logger.info("Created schedule %s: %s", schedule_id[:8], name)
        return await self.get_schedule(schedule_id)

    async def list_schedules(self, workspace_id: str) -> list:
        """列表查询"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, workspace_id, name, description, trigger_type,
                       trigger_config, task_type, task_config, enabled,
                       last_run_at, next_run_at, run_count, created_at, updated_at
                FROM schedules
                WHERE workspace_id = :workspace_id
                ORDER BY created_at DESC
                """),
                {"workspace_id": workspace_id},
            )
            rows = result.fetchall()

        items = []
        for row in rows:
            item = dict(row._mapping)
            item["trigger_config"] = json.loads(item["trigger_config"]) if item["trigger_config"] else {}
            item["task_config"] = json.loads(item["task_config"]) if item["task_config"] else {}
            items.append(item)
        return items

    async def get_schedule(self, schedule_id: str) -> Optional[dict]:
        """详情"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, workspace_id, name, description, trigger_type,
                       trigger_config, task_type, task_config, enabled,
                       last_run_at, next_run_at, run_count, created_at, updated_at
                FROM schedules WHERE id = :schedule_id
                """),
                {"schedule_id": schedule_id},
            )
            row = result.fetchone()
            if not row:
                return None
            item = dict(row._mapping)
            item["trigger_config"] = json.loads(item["trigger_config"]) if item["trigger_config"] else {}
            item["task_config"] = json.loads(item["task_config"]) if item["task_config"] else {}
            return item

    async def update_schedule(self, schedule_id: str, **kwargs) -> Optional[dict]:
        """更新 + 重新注册 APScheduler job"""
        schedule = await self.get_schedule(schedule_id)
        if not schedule:
            return None

        allowed_fields = {
            "name", "description", "trigger_type", "trigger_config",
            "task_type", "task_config", "enabled",
        }
        updates = {k: v for k, v in kwargs.items() if k in allowed_fields and v is not None}
        if not updates:
            return schedule

        # Serialize JSON fields
        if "trigger_config" in updates and isinstance(updates["trigger_config"], dict):
            updates["trigger_config"] = json.dumps(updates["trigger_config"])
        if "task_config" in updates and isinstance(updates["task_config"], dict):
            updates["task_config"] = json.dumps(updates["task_config"])

        updates["updated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        set_clauses = [f"{k} = :{k}" for k in updates]
        updates["schedule_id"] = schedule_id

        async with async_session_factory() as session:
            await session.execute(
                text(f"UPDATE schedules SET {', '.join(set_clauses)} WHERE id = :schedule_id"),
                updates,
            )
            await session.commit()

        # Re-register APScheduler job if trigger changed
        updated = await self.get_schedule(schedule_id)
        if updated and updated["enabled"]:
            try:
                trigger = self._build_trigger(
                    updated["trigger_type"], updated["trigger_config"]
                )
                self.scheduler.add_job(
                    self._execute_scheduled_task,
                    trigger=trigger,
                    id=schedule_id,
                    args=[schedule_id],
                    replace_existing=True,
                )
            except Exception as exc:
                logger.warning("Failed to re-register schedule %s: %s", schedule_id[:8], exc)
        else:
            # If disabled, remove the job
            try:
                self.scheduler.remove_job(schedule_id)
            except Exception:
                pass

        logger.info("Updated schedule %s", schedule_id[:8])
        return updated

    async def delete_schedule(self, schedule_id: str) -> bool:
        """删除 DB 记录 + 移除 APScheduler job"""
        schedule = await self.get_schedule(schedule_id)
        if not schedule:
            return False

        # Remove APScheduler job
        try:
            self.scheduler.remove_job(schedule_id)
        except Exception:
            pass

        async with async_session_factory() as session:
            # Delete runs first (FK constraint)
            await session.execute(
                text("DELETE FROM schedule_runs WHERE schedule_id = :schedule_id"),
                {"schedule_id": schedule_id},
            )
            await session.execute(
                text("DELETE FROM schedules WHERE id = :schedule_id"),
                {"schedule_id": schedule_id},
            )
            await session.commit()

        logger.info("Deleted schedule %s", schedule_id[:8])
        return True

    async def toggle_schedule(self, schedule_id: str) -> Optional[dict]:
        """启停切换 enabled 字段 + pause/resume APScheduler job"""
        schedule = await self.get_schedule(schedule_id)
        if not schedule:
            return None

        new_enabled = 0 if schedule["enabled"] else 1

        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE schedules
                SET enabled = :enabled, updated_at = :updated_at
                WHERE id = :schedule_id
                """),
                {
                    "enabled": new_enabled,
                    "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "schedule_id": schedule_id,
                },
            )
            await session.commit()

        if new_enabled:
            # Resume: re-register
            try:
                trigger = self._build_trigger(
                    schedule["trigger_type"], schedule["trigger_config"]
                )
                self.scheduler.add_job(
                    self._execute_scheduled_task,
                    trigger=trigger,
                    id=schedule_id,
                    args=[schedule_id],
                    replace_existing=True,
                )
            except Exception as exc:
                logger.warning("Failed to resume schedule %s: %s", schedule_id[:8], exc)
        else:
            # Pause: remove job
            try:
                self.scheduler.remove_job(schedule_id)
            except Exception:
                pass

        logger.info("Toggled schedule %s -> enabled=%d", schedule_id[:8], new_enabled)
        return await self.get_schedule(schedule_id)

    async def trigger_now(self, schedule_id: str) -> Optional[dict]:
        """手动触发一次"""
        schedule = await self.get_schedule(schedule_id)
        if not schedule:
            return None

        # Execute immediately in background
        asyncio.create_task(self._execute_scheduled_task(schedule_id))
        return schedule

    async def get_runs(self, schedule_id: str, limit: int = 20) -> list:
        """获取执行历史"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, schedule_id, task_id, status, trigger_type,
                       started_at, completed_at, result, error
                FROM schedule_runs
                WHERE schedule_id = :schedule_id
                ORDER BY started_at DESC
                LIMIT :limit
                """),
                {"schedule_id": schedule_id, "limit": limit},
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]

    # ── Execution callback ────────────────────────────────

    async def _execute_scheduled_task(self, schedule_id: str):
        """
        APScheduler job 执行函数。
        1. 记录 schedule_runs (status=running)
        2. 广播 WS: schedule.run.started
        3. 根据 task_type 调用 TaskService.create_task()
        4. 更新 schedule_runs (status=completed/failed)
        5. 更新 schedules.last_run_at + run_count
        6. 广播 WS: schedule.run.completed
        """
        run_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        # Load schedule info
        schedule = await self.get_schedule(schedule_id)
        if not schedule:
            logger.warning("Schedule %s not found during execution", schedule_id[:8])
            return

        # 1. Record run start
        async with async_session_factory() as session:
            await session.execute(
                text("""
                INSERT INTO schedule_runs
                    (id, schedule_id, status, trigger_type, started_at)
                VALUES (:id, :schedule_id, 'running', :trigger_type, :started_at)
                """),
                {
                    "id": run_id,
                    "schedule_id": schedule_id,
                    "trigger_type": schedule["trigger_type"],
                    "started_at": now,
                },
            )
            await session.commit()

        # 2. Broadcast WS: schedule.run.started
        await ws_hub.broadcast("schedules", {
            "type": "schedule.run.started",
            "schedule_id": schedule_id,
            "run_id": run_id,
            "workspace_id": schedule["workspace_id"],
        })

        task_id = None
        error_msg = None
        try:
            # 3. Create task based on task_type
            from backend.services.task_service import task_service

            task_config = schedule["task_config"]
            if schedule["task_type"] == "agent":
                task = await task_service.create_task(
                    workspace_id=schedule["workspace_id"],
                    prompt=task_config.get("prompt", "Scheduled task"),
                    agent_id=task_config.get("agent_id", "codex"),
                    model=task_config.get("model", ""),
                    cwd=task_config.get("cwd", ""),
                )
                task_id = task["id"] if task else None
            elif schedule["task_type"] == "plan":
                # Create a proper Plan via plan_service
                from backend.services.plan_service import plan_service

                definition = task_config.get("definition")
                if not definition:
                    # Fallback: wrap a single task prompt into a Plan definition
                    definition = {
                        "max_parallel": task_config.get("max_parallel", 1),
                        "tasks": [
                            {
                                "prompt": task_config.get("prompt", f"Scheduled plan task"),
                                "agent_id": task_config.get("agent_id", "codex"),
                            }
                        ],
                    }

                plan = await plan_service.create_plan(
                    workspace_id=schedule["workspace_id"],
                    definition_json=definition,
                    cwd=task_config.get("cwd", "") or None,
                    model=task_config.get("model", "") or None,
                )
                # Use plan_id as the run's reference task_id for tracking
                task_id = plan["id"] if plan else None
                logger.info(
                    "Schedule %s created plan=%s with %d tasks",
                    schedule_id[:8],
                    (task_id or "")[:8],
                    len(definition.get("tasks", [])),
                )
            elif schedule["task_type"] == "workflow":
                # 一次性自动化工作流：通过 WorkflowEngine.start_run 触发 DAG 执行
                workflow_id = task_config.get("workflow_id")
                if not workflow_id:
                    raise ValueError("workflow task_config must include workflow_id")
                input_context = task_config.get("input_context", {}) or {}

                from backend.services.workflow_engine import workflow_engine

                run_id = await workflow_engine.start_run(
                    workflow_id=workflow_id,
                    input_context=input_context,
                    trigger_type="schedule",
                )
                # 以 run_id 作为 task_id 记录，保留与其他 task_type 一致的追踪语义
                task_id = run_id
                logger.info(
                    "Schedule %s started workflow run=%s (workflow=%s)",
                    schedule_id[:8],
                    (run_id or "")[:8],
                    (workflow_id or "")[:8],
                )
            elif schedule["task_type"] in ("status", "custom"):
                # For status/custom: create a basic agent task with prompt
                task = await task_service.create_task(
                    workspace_id=schedule["workspace_id"],
                    prompt=task_config.get("prompt", f"Scheduled {schedule['task_type']} task"),
                    agent_id=task_config.get("agent_id", "codex"),
                    model=task_config.get("model", ""),
                    cwd=task_config.get("cwd", ""),
                )
                task_id = task["id"] if task else None

            # 4. Update run: completed
            completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            async with async_session_factory() as session:
                await session.execute(
                    text("""
                    UPDATE schedule_runs
                    SET status = 'completed', task_id = :task_id,
                        completed_at = :completed_at,
                        result = :result
                    WHERE id = :run_id
                    """),
                    {
                        "task_id": task_id,
                        "completed_at": completed_at,
                        "result": json.dumps({"task_id": task_id}),
                        "run_id": run_id,
                    },
                )
                await session.commit()

        except Exception as exc:
            error_msg = str(exc)
            logger.exception("Schedule %s execution failed", schedule_id[:8])

            # 4. Update run: failed
            completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            async with async_session_factory() as session:
                await session.execute(
                    text("""
                    UPDATE schedule_runs
                    SET status = 'failed', completed_at = :completed_at,
                        error = :error
                    WHERE id = :run_id
                    """),
                    {
                        "completed_at": completed_at,
                        "error": error_msg,
                        "run_id": run_id,
                    },
                )
                await session.commit()

        # 5. Update schedules.last_run_at + run_count
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE schedules
                SET last_run_at = :last_run_at,
                    run_count = run_count + 1,
                    updated_at = :updated_at
                WHERE id = :schedule_id
                """),
                {
                    "last_run_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "schedule_id": schedule_id,
                },
            )
            await session.commit()

        # 6. Broadcast WS: schedule.run.completed
        await ws_hub.broadcast("schedules", {
            "type": "schedule.run.completed",
            "schedule_id": schedule_id,
            "run_id": run_id,
            "task_id": task_id,
            "workspace_id": schedule["workspace_id"],
            "status": "failed" if error_msg else "completed",
            "error": error_msg,
        })

    # ── Trigger builder ───────────────────────────────────

    def _build_trigger(self, trigger_type: str, trigger_config: dict):
        """构建 APScheduler trigger 对象"""
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger
        from apscheduler.triggers.date import DateTrigger

        if trigger_type == "cron":
            cron_expr = trigger_config.get("cron", "0 * * * *")
            timezone = trigger_config.get("timezone", "UTC")
            # Parse cron expression: minute hour day month day_of_week
            parts = cron_expr.strip().split()
            if len(parts) == 5:
                minute, hour, day, month, day_of_week = parts
                return CronTrigger(
                    minute=minute,
                    hour=hour,
                    day=day,
                    month=month,
                    day_of_week=day_of_week,
                    timezone=timezone,
                )
            elif len(parts) == 6:
                # Extended: second minute hour day month day_of_week
                second, minute, hour, day, month, day_of_week = parts
                return CronTrigger(
                    second=second,
                    minute=minute,
                    hour=hour,
                    day=day,
                    month=month,
                    day_of_week=day_of_week,
                    timezone=timezone,
                )
            else:
                raise ValueError(f"Invalid cron expression: {cron_expr}")

        elif trigger_type == "interval":
            return IntervalTrigger(
                weeks=trigger_config.get("weeks", 0),
                days=trigger_config.get("days", 0),
                hours=trigger_config.get("hours", 0),
                minutes=trigger_config.get("minutes", 0),
                seconds=trigger_config.get("seconds", 0) or 3600,
            )

        elif trigger_type == "date":
            run_at = trigger_config.get("run_at")
            if not run_at:
                raise ValueError("date trigger requires 'run_at' in trigger_config")
            return DateTrigger(run_date=run_at)

        else:
            raise ValueError(f"Unknown trigger_type: {trigger_type}")


# 全局单例
schedule_service = ScheduleService()
