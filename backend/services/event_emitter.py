"""统一事件发射系统

所有业务状态变更通过此模块广播到 WebSocket channel + 写入 task_events 表。
单例 event_emitter 供所有模块使用。
"""

import json
import uuid
from typing import Optional

from backend.services.ws_hub import ws_hub
from backend.db.engine import async_session_factory


class EventTypes:
    TASK_CREATED = "task.created"
    TASK_UPDATED = "task.updated"
    TASK_DELETED = "task.deleted"
    TASK_STATUS_CHANGED = "task.status_changed"
    TASK_OUTPUT = "task.output"
    TASK_APPROVAL_REQUEST = "task.approval_request"
    PLAN_TASK_STARTED = "plan.task.started"
    PLAN_TASK_COMPLETED = "plan.task.completed"
    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_RESOLVED = "approval.resolved"
    WORKFLOW_NODE_STARTED = "workflow.node.started"
    WORKFLOW_NODE_COMPLETED = "workflow.node.completed"
    SCHEDULE_RUN_STARTED = "schedule.run.started"
    SCHEDULE_RUN_COMPLETED = "schedule.run.completed"
    # Lark 桥接事件（来自 lark2agent_ws.py）
    LARK_TASK_CREATED = "lark.task.created"
    LARK_TASK_UPDATED = "lark.task.updated"


class EventEmitter:
    async def emit_task_created(self, task_id: str, workspace_id: str):
        """任务创建事件"""
        event = {
            "type": EventTypes.TASK_CREATED,
            "task_id": task_id,
            "workspace_id": workspace_id,
        }
        await self._record_event(task_id, workspace_id, "created")
        await ws_hub.broadcast("tasks", event)
        await ws_hub.broadcast(f"task:{task_id}", event)

    async def emit_task_updated(self, task_id: str, workspace_id: str, updates: dict):
        """任务字段更新事件"""
        event = {
            "type": EventTypes.TASK_UPDATED,
            "task_id": task_id,
            "workspace_id": workspace_id,
            "updates": updates,
        }
        await self._record_event(task_id, workspace_id, "updated", updates)
        await ws_hub.broadcast("tasks", event)
        await ws_hub.broadcast(f"task:{task_id}", event)

    async def emit_task_deleted(self, task_id: str, workspace_id: str):
        """任务删除事件。任务行删除后不再写 task_events。"""
        event = {
            "type": EventTypes.TASK_DELETED,
            "task_id": task_id,
            "workspace_id": workspace_id,
        }
        await ws_hub.broadcast("tasks", event)
        await ws_hub.broadcast(f"task:{task_id}", event)

    async def emit_task_status_changed(
        self,
        task_id: str,
        workspace_id: str,
        old_status: str,
        new_status: str,
        actor_id: str = None,
    ):
        """任务状态变更事件"""
        event = {
            "type": EventTypes.TASK_STATUS_CHANGED,
            "task_id": task_id,
            "workspace_id": workspace_id,
            "old_status": old_status,
            "new_status": new_status,
        }
        await self._record_event(
            task_id, workspace_id,
            f"status_changed:{new_status}",
            {"old_status": old_status, "new_status": new_status},
            actor_id,
        )
        await ws_hub.broadcast("tasks", event)
        await ws_hub.broadcast(f"task:{task_id}", event)

        # 同步通知 Lark Bridge：若任务来源于 Lark（chat_id 非空），尝试更新 Lark 卡片。
        # 失败不阻塞主流程。
        try:
            from backend.services.lark_bridge import lark_bridge
            await lark_bridge.on_task_status_changed(task_id, new_status, source="web")
        except Exception:
            import logging
            logging.getLogger("lark2agent.event_emitter").debug(
                "lark_bridge notify skipped", exc_info=True,
            )

    async def emit_lark_task_created(self, task_data: dict):
        """Lark 来源任务创建事件（由 LarkBridge 转发）。"""
        from backend.services.lark_bridge import lark_bridge
        await lark_bridge.on_lark_task_created(task_data)

    async def emit_lark_task_updated(self, task_id: str, updates: dict):
        """Lark 来源任务更新事件（由 LarkBridge 转发）。"""
        from backend.services.lark_bridge import lark_bridge
        await lark_bridge.on_lark_task_updated(task_id, updates)

    async def emit_task_output(self, task_id: str, workspace_id: str, chunk: str, output_type: str = "output"):
        """任务输出事件（流式）"""
        event = {
            "type": EventTypes.TASK_OUTPUT,
            "task_id": task_id,
            "workspace_id": workspace_id,
            "chunk": chunk,
            "output_type": output_type,
        }
        await self._record_event(
            task_id,
            workspace_id,
            "output",
            {"chunk": chunk, "output_type": output_type},
        )
        await ws_hub.broadcast("tasks", event)
        await ws_hub.broadcast(f"task:{task_id}", event)

    async def emit_task_approval_request(self, task_id: str, workspace_id: str, content: str):
        """推送审批请求（Agent 执行时触发）"""
        event = {
            "type": EventTypes.TASK_APPROVAL_REQUEST,
            "task_id": task_id,
            "workspace_id": workspace_id,
            "content": content,
        }
        await self._record_event(
            task_id,
            workspace_id,
            "approval_request",
            {"content": content},
        )
        await ws_hub.broadcast("tasks", event)
        await ws_hub.broadcast("approvals", event)
        await ws_hub.broadcast(f"task:{task_id}", event)

    async def emit_approval_requested(
        self,
        task_id: str,
        workspace_id: str,
        approval_id: str,
        reason: str = "",
    ):
        """审批请求事件"""
        event = {
            "type": EventTypes.APPROVAL_REQUESTED,
            "task_id": task_id,
            "workspace_id": workspace_id,
            "approval_id": approval_id,
            "reason": reason,
        }
        await self._record_event(
            task_id, workspace_id,
            "review_requested",
            {"approval_id": approval_id, "reason": reason},
        )
        await ws_hub.broadcast("tasks", event)
        await ws_hub.broadcast("approvals", event)
        await ws_hub.broadcast(f"task:{task_id}", event)

    async def emit_approval_resolved(
        self,
        task_id: str,
        workspace_id: str,
        approval_id: str,
        status: str,
        actor_id: str = None,
    ):
        """审批完成事件"""
        event = {
            "type": EventTypes.APPROVAL_RESOLVED,
            "task_id": task_id,
            "workspace_id": workspace_id,
            "approval_id": approval_id,
            "status": status,
        }
        await self._record_event(
            task_id, workspace_id,
            f"approval_{status}",
            {"approval_id": approval_id, "status": status},
            actor_id,
        )
        await ws_hub.broadcast("tasks", event)
        await ws_hub.broadcast("approvals", event)
        await ws_hub.broadcast(f"task:{task_id}", event)

    async def _record_event(
        self,
        task_id: str,
        workspace_id: str,
        event_type: str,
        payload: dict = None,
        actor_id: str = None,
    ):
        """写入 task_events 表"""
        event_id = str(uuid.uuid4())
        async with async_session_factory() as session:
            from sqlalchemy import text
            await session.execute(
                text(
                    "INSERT INTO task_events "
                    "(id, task_id, workspace_id, actor_id, event_type, payload) "
                    "VALUES (:id, :task_id, :workspace_id, :actor_id, :event_type, :payload)"
                ),
                {
                    "id": event_id,
                    "task_id": task_id,
                    "workspace_id": workspace_id,
                    "actor_id": actor_id,
                    "event_type": event_type,
                    "payload": json.dumps(payload) if payload else None,
                },
            )
            await session.commit()


# 全局单例
event_emitter = EventEmitter()
