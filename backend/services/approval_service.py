"""
ApprovalService — 审批流持久化 + 完整生命周期管理。

职责：
- 创建审批记录（写 DB → 通知前端 WebSocket → 发送 Lark 审批卡片）
- 审批通过（恢复任务执行）
- 审批拒绝（终止任务）
- 查询接口（pending / by_task / 单条详情）
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.event_emitter import event_emitter

logger = logging.getLogger("tide.approval_service")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ApprovalService:
    """审批服务（全局单例）。"""

    # ── 创建审批 ───────────────────────────────────────────

    async def create_approval(
        self,
        task_id: str,
        workspace_id: str,
        approval_type: str,
        detail: Optional[dict] = None,
        chat_id: Optional[str] = None,
        plan_id: Optional[str] = None,
    ) -> str:
        """
        创建审批记录：
        1. 写入 approvals 表
        2. 更新 task 状态为 'review'
        3. emit WebSocket 事件通知前端
        4. 如果有 chat_id → lark_bridge 发送审批卡片
        返回 approval_id
        """
        approval_id = str(uuid.uuid4())
        detail_json = json.dumps(detail or {}, ensure_ascii=False)

        async with async_session_factory() as session:
            await session.execute(
                text("""
                INSERT INTO approvals
                    (id, task_id, plan_id, workspace_id, chat_id, type, detail, status, created_at)
                VALUES
                    (:id, :task_id, :plan_id, :workspace_id, :chat_id, :type, :detail, 'pending', :created_at)
                """),
                {
                    "id": approval_id,
                    "task_id": task_id,
                    "plan_id": plan_id,
                    "workspace_id": workspace_id,
                    "chat_id": chat_id,
                    "type": approval_type,
                    "detail": detail_json,
                    "created_at": _now_iso(),
                },
            )
            await session.commit()

        # emit WebSocket 事件
        reason = (detail or {}).get("reason", "") or approval_type
        await event_emitter.emit_approval_requested(
            task_id, workspace_id, approval_id, reason=reason
        )

        # 如果有 chat_id → 发送 Lark 审批卡片
        if chat_id:
            try:
                from backend.services.lark_bridge import lark_bridge
                from backend.services.task_service import task_service

                task_data = await task_service.get_task(task_id)
                if task_data:
                    await lark_bridge.send_task_card(task_data)
            except Exception:
                logger.debug("send lark approval card failed", exc_info=True)

        logger.info(
            "[approval_service] created approval=%s task=%s type=%s",
            approval_id[:8], task_id[:8], approval_type,
        )
        return approval_id

    # ── 审批通过 ───────────────────────────────────────────

    async def approve(self, approval_id: str, operator_id: Optional[str] = None) -> bool:
        """
        审批通过：
        1. 更新 approvals 状态为 approved
        2. 恢复任务执行（通过 task_service 或 plan_executor）
        3. emit 事件
        4. 更新 Lark 卡片
        """
        approval = await self.get_approval(approval_id)
        if not approval:
            logger.warning("[approval_service] approve: not found id=%s", approval_id[:8])
            return False
        if approval["status"] != "pending":
            logger.warning(
                "[approval_service] approve: already resolved id=%s status=%s",
                approval_id[:8], approval["status"],
            )
            return False

        # 更新审批记录
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE approvals
                SET status = 'approved', operator_id = :operator_id, resolved_at = :resolved_at
                WHERE id = :id
                """),
                {
                    "id": approval_id,
                    "operator_id": operator_id,
                    "resolved_at": _now_iso(),
                },
            )
            await session.commit()

        task_id = approval["task_id"]
        workspace_id = approval["workspace_id"]
        plan_id = approval.get("plan_id")

        # emit 事件
        await event_emitter.emit_approval_resolved(
            task_id, workspace_id, approval_id, "approved", actor_id=operator_id,
        )

        # 恢复执行
        if plan_id:
            # Plan 子任务：通过 plan_executor 恢复
            try:
                from backend.services.plan_executor import plan_executor
                await plan_executor.approve_task(plan_id, task_id)
            except Exception:
                logger.exception(
                    "[approval_service] plan_executor.approve_task failed plan=%s task=%s",
                    plan_id[:8], task_id[:8],
                )
        else:
            # 普通任务：通过 task_service 重新执行（approved 模式）
            try:
                from backend.services.task_service import task_service
                await task_service.approve_task(task_id)
            except Exception:
                logger.exception(
                    "[approval_service] task_service.approve_task failed task=%s",
                    task_id[:8],
                )

        # 更新 Lark 卡片
        await self._update_lark_card(task_id)

        logger.info(
            "[approval_service] approved id=%s task=%s operator=%s",
            approval_id[:8], task_id[:8], operator_id or "-",
        )
        return True

    # ── 审批拒绝 ───────────────────────────────────────────

    async def reject(self, approval_id: str, operator_id: Optional[str] = None) -> bool:
        """
        审批拒绝：
        1. 更新 approvals 状态为 rejected
        2. 取消/失败任务
        3. emit 事件
        4. 更新 Lark 卡片
        """
        approval = await self.get_approval(approval_id)
        if not approval:
            logger.warning("[approval_service] reject: not found id=%s", approval_id[:8])
            return False
        if approval["status"] != "pending":
            logger.warning(
                "[approval_service] reject: already resolved id=%s status=%s",
                approval_id[:8], approval["status"],
            )
            return False

        # 更新审批记录
        async with async_session_factory() as session:
            await session.execute(
                text("""
                UPDATE approvals
                SET status = 'rejected', operator_id = :operator_id, resolved_at = :resolved_at
                WHERE id = :id
                """),
                {
                    "id": approval_id,
                    "operator_id": operator_id,
                    "resolved_at": _now_iso(),
                },
            )
            await session.commit()

        task_id = approval["task_id"]
        workspace_id = approval["workspace_id"]
        plan_id = approval.get("plan_id")

        # emit 事件
        await event_emitter.emit_approval_resolved(
            task_id, workspace_id, approval_id, "rejected", actor_id=operator_id,
        )

        # 终止任务
        if plan_id:
            try:
                from backend.services.plan_executor import plan_executor
                # 直接更新任务状态为 rejected
                await plan_executor._update_task(task_id, status="rejected", result="审批被拒绝。")
            except Exception:
                logger.exception(
                    "[approval_service] plan task reject failed plan=%s task=%s",
                    plan_id[:8], task_id[:8],
                )
        else:
            try:
                from backend.services.task_service import task_service
                await task_service.reject_task(task_id, reason="审批被拒绝。")
            except Exception:
                logger.exception(
                    "[approval_service] task reject failed task=%s",
                    task_id[:8],
                )

        # 更新 Lark 卡片
        await self._update_lark_card(task_id)

        logger.info(
            "[approval_service] rejected id=%s task=%s operator=%s",
            approval_id[:8], task_id[:8], operator_id or "-",
        )
        return True

    # ── 查询接口 ───────────────────────────────────────────

    async def get_pending(self, workspace_id: str) -> list[dict]:
        """获取待审批列表"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, task_id, plan_id, workspace_id, chat_id,
                       type, detail, status, operator_id, created_at, resolved_at
                FROM approvals
                WHERE workspace_id = :workspace_id AND status = 'pending'
                ORDER BY created_at DESC
                """),
                {"workspace_id": workspace_id},
            )
            return [dict(row._mapping) for row in result.fetchall()]

    async def get_by_task(self, task_id: str) -> list[dict]:
        """获取任务的所有审批记录"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, task_id, plan_id, workspace_id, chat_id,
                       type, detail, status, operator_id, created_at, resolved_at
                FROM approvals
                WHERE task_id = :task_id
                ORDER BY created_at DESC
                """),
                {"task_id": task_id},
            )
            return [dict(row._mapping) for row in result.fetchall()]

    async def get_approval(self, approval_id: str) -> Optional[dict]:
        """获取单个审批详情"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, task_id, plan_id, workspace_id, chat_id,
                       type, detail, status, operator_id, created_at, resolved_at
                FROM approvals
                WHERE id = :id
                """),
                {"id": approval_id},
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None

    async def list_approvals(
        self,
        workspace_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """通用列表查询"""
        conditions = []
        params: dict = {"limit": limit, "offset": offset}

        if workspace_id:
            conditions.append("workspace_id = :workspace_id")
            params["workspace_id"] = workspace_id
        if status:
            conditions.append("status = :status")
            params["status"] = status

        where = " AND ".join(conditions) if conditions else "1=1"

        async with async_session_factory() as session:
            result = await session.execute(
                text(f"""
                SELECT id, task_id, plan_id, workspace_id, chat_id,
                       type, detail, status, operator_id, created_at, resolved_at
                FROM approvals
                WHERE {where}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
                """),
                params,
            )
            return [dict(row._mapping) for row in result.fetchall()]

    # ── 辅助方法 ───────────────────────────────────────────

    async def _update_lark_card(self, task_id: str) -> None:
        """更新 Lark 卡片（防御性调用，不阻塞主流程）。"""
        try:
            from backend.services.lark_bridge import lark_bridge
            from backend.services.task_service import task_service

            task_data = await task_service.get_task(task_id)
            if task_data and (task_data.get("chat_id") or "").strip():
                await lark_bridge.send_task_card(task_data)
        except Exception:
            logger.debug("_update_lark_card failed task=%s", task_id[:8], exc_info=True)

    async def get_pending_by_task(self, task_id: str) -> Optional[dict]:
        """获取任务当前的 pending 审批（最新一条）"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                SELECT id, task_id, plan_id, workspace_id, chat_id,
                       type, detail, status, operator_id, created_at, resolved_at
                FROM approvals
                WHERE task_id = :task_id AND status = 'pending'
                ORDER BY created_at DESC
                LIMIT 1
                """),
                {"task_id": task_id},
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None


# 全局单例
approval_service = ApprovalService()
