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
    # Lark 桥接事件（来自 tide_ws.py）
    LARK_TASK_CREATED = "lark.task.created"
    LARK_TASK_UPDATED = "lark.task.updated"
    # Freeform collaboration events
    WORK_ITEM_ASSIGNED = "work_item.assigned"
    WORK_ITEM_DISPATCH_STARTED = "work_item.dispatch_started"
    ASSIGNMENT_STATUS_CHANGED = "assignment.status_changed"
    WORK_ITEM_CONTEXT_UPDATED = "work_item.context_updated"
    WORK_ITEM_COMMENT_ADDED = "work_item.comment_added"
    WORK_ITEM_COMMENT_UPDATED = "work_item.comment_updated"
    WORK_ITEM_BLOCKED = "work_item.blocked"
    WORK_ITEM_UNBLOCKED = "work_item.unblocked"


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
            logging.getLogger("tide.event_emitter").debug(
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

    async def emit_work_item_assigned(
        self,
        work_item_id: str,
        target_type: str,
        target_id: str,
        assigned_by: str,
        role: str = "executor",
    ):
        """广播工作项分配事件。"""
        event = {
            "type": EventTypes.WORK_ITEM_ASSIGNED,
            "work_item_id": work_item_id,
            "target_type": target_type,
            "target_id": target_id,
            "assigned_by": assigned_by,
            "role": role,
        }
        await ws_hub.broadcast("work_items", event)
        # Also broadcast to item-specific channel
        await ws_hub.broadcast(f"work_item:{work_item_id}", event)

    async def emit_work_item_dispatch_started(
        self,
        work_item_id: str,
        leader_id: str,
        member_ids: list,
    ):
        """广播 Squad Leader 派遣事件。"""
        event = {
            "type": EventTypes.WORK_ITEM_DISPATCH_STARTED,
            "work_item_id": work_item_id,
            "leader_id": leader_id,
            "member_ids": member_ids,
        }
        await ws_hub.broadcast("work_items", event)
        await ws_hub.broadcast(f"work_item:{work_item_id}", event)

    async def emit_assignment_status_changed(
        self,
        assignment_id: str,
        work_item_id: str,
        old_status: str,
        new_status: str,
        actor_id: str = None,
    ):
        """广播分配状态变更事件。"""
        event = {
            "type": EventTypes.ASSIGNMENT_STATUS_CHANGED,
            "assignment_id": assignment_id,
            "work_item_id": work_item_id,
            "old_status": old_status,
            "new_status": new_status,
            "actor_id": actor_id,
        }
        await ws_hub.broadcast("work_items", event)
        await ws_hub.broadcast(f"work_item:{work_item_id}", event)

    async def emit_work_item_context_updated(
        self,
        work_item_id: str,
        context_type: str,
        author_id: str,
    ):
        """广播工作项共享上下文更新事件。"""
        event = {
            "type": EventTypes.WORK_ITEM_CONTEXT_UPDATED,
            "work_item_id": work_item_id,
            "context_type": context_type,
            "author_id": author_id,
        }
        await ws_hub.broadcast("work_items", event)
        await ws_hub.broadcast(f"work_item:{work_item_id}", event)

    async def emit_work_item_comment(self, work_item_id: str, comment: dict):
        """广播工作项评论添加事件。"""
        event = {
            "type": EventTypes.WORK_ITEM_COMMENT_ADDED,
            "work_item_id": work_item_id,
            "comment": comment,
        }
        await ws_hub.broadcast("work_items", event)
        await ws_hub.broadcast(f"work_item:{work_item_id}", event)

    async def emit_work_item_comment_updated(self, work_item_id: str, comment: dict):
        """广播工作项评论更新事件（如关联任务 task_status 变化）。"""
        event = {
            "type": EventTypes.WORK_ITEM_COMMENT_UPDATED,
            "work_item_id": work_item_id,
            "comment": comment,
        }
        await ws_hub.broadcast("work_items", event)
        await ws_hub.broadcast(f"work_item:{work_item_id}", event)

    async def emit_work_item_blocked(self, work_item_id: str, reason: str = ""):
        """广播工作项进入阻塞状态（待审批）事件。"""
        event = {
            "type": EventTypes.WORK_ITEM_BLOCKED,
            "work_item_id": work_item_id,
            "reason": reason,
        }
        await ws_hub.broadcast("work_items", event)
        await ws_hub.broadcast(f"work_item:{work_item_id}", event)

    async def emit_work_item_unblocked(self, work_item_id: str):
        """广播工作项解除阻塞事件。"""
        event = {
            "type": EventTypes.WORK_ITEM_UNBLOCKED,
            "work_item_id": work_item_id,
        }
        await ws_hub.broadcast("work_items", event)
        await ws_hub.broadcast(f"work_item:{work_item_id}", event)

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
