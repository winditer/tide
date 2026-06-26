"""
CardActionHandler — Lark 卡片按钮回调分发。

从 tide_ws.py:handle_card_action()（L8089-8353）提取核心业务动作，
适配新后端 service 层（task_service / plan_service / dashboard 聚合）。

action_value 采用扁平字符串格式，与 backend/services/card_builder.py 中
button() 一致：

  task_stop_<task_id>
  task_approve_<task_id>
  task_reject_<task_id>
  task_retry_<task_id>
  task_refresh_<task_id>
  task_detail_<task_id>

  plan_stop_<plan_id>
  plan_refresh_<plan_id>
  plan_detail_<plan_id>
  plan_retry_failed_<plan_id>

  plan_task_stop_<plan_id>_<task_id>
  plan_task_cancel_<plan_id>_<task_id>
  plan_task_retry_<plan_id>_<task_id>
  plan_task_detail_<plan_id>_<task_id>
  plan_approve_<plan_id>_<task_id>
  plan_reject_<plan_id>_<task_id>

  dashboard_refresh_<workspace_id>
  dashboard_tasks_<workspace_id>
  dashboard_plans_<workspace_id>
  dashboard_kanban_<workspace_id>

返回值约定：
- dict：替换原卡片
- None：不更新卡片（Lark 端忽略）
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy import text

from backend.core.dependencies import (
    check_cwd_write_permission,
    check_lark_permission,
    LarkPermissionDenied,
    resolve_lark_user,
)
from backend.db.engine import async_session_factory
from backend.runtime.config import LARK_ALLOWED_OPEN_IDS, TIDE_REQUIRE_AUTH
from backend.services.card_builder import (
    build_dashboard_card,
    build_plan_card,
    build_simple_notice_card,
    build_task_card,
)
from backend.services.plan_service import plan_service
from backend.services.task_service import task_service
from backend.services.approval_service import approval_service

logger = logging.getLogger("tide.card_action_handler")

# ── action 前缀映射 ────────────────────────────────────────────
# 顺序：双 ID（plan + task）优先于单 ID，避免 plan_task_stop_ 被
# 误匹配为 plan_ 开头的单 ID 动作。

_TWO_ID_PREFIXES: tuple[str, ...] = (
    "plan_task_detail_",
    "plan_task_cancel_",
    "plan_task_retry_",
    "plan_task_stop_",
    "plan_approve_",
    "plan_reject_",
)

_SINGLE_ID_PREFIXES: tuple[str, ...] = (
    # plan 单 ID（"retry_failed" 必须先于 "refresh"/"stop"/"detail"）
    "plan_retry_failed_",
    "plan_refresh_",
    "plan_detail_",
    "plan_stop_",
    # task 单 ID
    "task_refresh_",
    "task_approve_",
    "task_reject_",
    "task_retry_",
    "task_detail_",
    "task_stop_",
    # dashboard 单 ID（workspace_id）
    "dashboard_refresh_",
    "dashboard_tasks_",
    "dashboard_plans_",
    "dashboard_kanban_",
)


def parse_action_value(value: str) -> Optional[tuple[str, str, Optional[str]]]:
    """解析 action_value 字符串。

    Returns:
        (verb, id1, id2 or None) 三元组；无法识别返回 None。
        verb 为去掉末尾下划线的前缀。
    """
    if not value or not isinstance(value, str):
        return None

    for prefix in _TWO_ID_PREFIXES:
        if value.startswith(prefix):
            rest = value[len(prefix):]
            parts = rest.split("_", 1)
            if len(parts) != 2 or not parts[0] or not parts[1]:
                return None
            return prefix.rstrip("_"), parts[0], parts[1]

    for prefix in _SINGLE_ID_PREFIXES:
        if value.startswith(prefix):
            rest = value[len(prefix):]
            if not rest:
                return None
            return prefix.rstrip("_"), rest, None

    return None


# ── 数据装配 ──────────────────────────────────────────────────


async def _load_plan_with_tasks(plan_id: str) -> Optional[dict]:
    """读 plan 行 + 注入子任务列表（用于重建 plan 卡片）。"""
    plan = await plan_service.get_plan(plan_id)
    if not plan:
        return None

    async with async_session_factory() as session:
        result = await session.execute(
            text(
                """
                SELECT t.id, t.workspace_id, t.plan_id, t.prompt, t.cwd,
                       t.model, t.agent_id, t.session_id, t.status, t.result,
                       t.started_at, t.completed_at, t.duration_ms,
                       pt.task_index, pt.phase, pt.depends_on
                FROM plan_tasks pt
                JOIN tasks t ON t.id = pt.task_id
                WHERE pt.plan_id = :plan_id
                ORDER BY pt.task_index
                """
            ),
            {"plan_id": plan_id},
        )
        rows = result.fetchall()

    tasks: list[dict] = []
    for row in rows:
        item = dict(row._mapping)
        # plan_card 期望 title 字段
        prompt = item.get("prompt") or ""
        item["title"] = prompt[:80] if prompt else ""
        tasks.append(item)
    plan["tasks"] = tasks
    return plan


async def _aggregate_dashboard_stats(workspace_id: str) -> dict:
    """聚合 Dashboard 卡片所需的统计快照。"""
    snapshot: dict[str, Any] = {
        "workspace_id": workspace_id,
        "projects": 0,
        "chats": 0,
        "tasks": {},
        "plans": {},
        "agents": {},
        "pending_approvals": [],
        "recent_failed": [],
    }

    async with async_session_factory() as session:
        # 任务计数
        result = await session.execute(
            text(
                """
                SELECT status, COUNT(*) AS cnt
                FROM tasks WHERE workspace_id = :ws
                GROUP BY status
                """
            ),
            {"ws": workspace_id},
        )
        task_stats: dict[str, int] = {"total": 0}
        for row in result.fetchall():
            r = dict(row._mapping)
            st = (r.get("status") or "").lower()
            cnt = int(r.get("cnt") or 0)
            task_stats[st] = cnt
            task_stats["total"] += cnt
        # 兼容字段
        task_stats.setdefault("review", task_stats.get("review", 0))
        snapshot["tasks"] = task_stats

        # Plan 计数
        result = await session.execute(
            text(
                """
                SELECT status, COUNT(*) AS cnt
                FROM plans WHERE workspace_id = :ws
                GROUP BY status
                """
            ),
            {"ws": workspace_id},
        )
        plan_stats: dict[str, int] = {"total": 0, "active": 0, "completed": 0}
        for row in result.fetchall():
            r = dict(row._mapping)
            st = (r.get("status") or "").lower()
            cnt = int(r.get("cnt") or 0)
            plan_stats["total"] += cnt
            if st == "active":
                plan_stats["active"] += cnt
            elif st in ("completed", "done"):
                plan_stats["completed"] += cnt
        snapshot["plans"] = plan_stats

        # Agent 计数
        result = await session.execute(
            text(
                """
                SELECT agent_id, COUNT(*) AS cnt
                FROM tasks WHERE workspace_id = :ws
                GROUP BY agent_id
                """
            ),
            {"ws": workspace_id},
        )
        snapshot["agents"] = {
            (dict(row._mapping).get("agent_id") or "unknown"): int(
                dict(row._mapping).get("cnt") or 0
            )
            for row in result.fetchall()
        }

        # 待审批任务（最多 5）
        result = await session.execute(
            text(
                """
                SELECT id, agent_id, prompt, chat_id
                FROM tasks
                WHERE workspace_id = :ws AND status IN ('review', 'approval_request')
                ORDER BY created_at DESC LIMIT 5
                """
            ),
            {"ws": workspace_id},
        )
        snapshot["pending_approvals"] = [
            dict(row._mapping) for row in result.fetchall()
        ]

        # 最近失败任务（最多 5）
        result = await session.execute(
            text(
                """
                SELECT id, agent_id, prompt, result
                FROM tasks
                WHERE workspace_id = :ws AND status = 'failed'
                ORDER BY completed_at DESC LIMIT 5
                """
            ),
            {"ws": workspace_id},
        )
        snapshot["recent_failed"] = [
            dict(row._mapping) for row in result.fetchall()
        ]

        # 项目计数（从 tasks.cwd 去重推导）
        result = await session.execute(
            text(
                """
                SELECT COUNT(DISTINCT cwd) FROM tasks
                WHERE workspace_id = :ws AND cwd IS NOT NULL AND cwd != ''
                """
            ),
            {"ws": workspace_id},
        )
        snapshot["projects"] = int(result.scalar() or 0)
        # 会话计数（从 tasks.session_id 去重）
        result = await session.execute(
            text(
                """
                SELECT COUNT(DISTINCT session_id) FROM tasks
                WHERE workspace_id = :ws AND session_id IS NOT NULL AND session_id != ''
                """
            ),
            {"ws": workspace_id},
        )
        snapshot["chats"] = int(result.scalar() or 0)

    return snapshot


# ── 主分发器 ──────────────────────────────────────────────────


class CardActionHandler:
    """处理 Lark 卡片按钮回调，返回更新后的卡片 dict 或 None。"""

    async def handle(
        self,
        action_value: str,
        operator_id: str = "",
        chat_id: str = "",
        message_id: str = "",
    ) -> Optional[dict]:
        # === 权限前置检查 ===
        # 白名单检查
        if LARK_ALLOWED_OPEN_IDS and operator_id not in LARK_ALLOWED_OPEN_IDS:
            return self._permission_denied_card("您不在操作白名单中")

        # 身份解析
        current_user: Optional[dict] = None
        if TIDE_REQUIRE_AUTH:
            try:
                current_user = await check_lark_permission(operator_id)
            except LarkPermissionDenied as e:
                if e.reason == "user_not_bound":
                    return self._permission_denied_card("您的飞书账号尚未绑定 Tide 系统")
                elif e.reason == "user_disabled":
                    return self._permission_denied_card("您的账号已被禁用")
                else:
                    return self._permission_denied_card("权限不足")
        else:
            current_user = await resolve_lark_user(operator_id)

        # === 解析并分发 ===
        parsed = parse_action_value(action_value)
        if not parsed:
            logger.warning("unknown card action_value: %s", action_value)
            return build_simple_notice_card(
                "未识别操作", f"未知操作：`{action_value}`", template="red"
            )

        verb, id1, id2 = parsed
        try:
            return await self._dispatch(verb, id1, id2, operator_id, chat_id, current_user)
        except Exception:
            logger.exception(
                "card action failed: verb=%s id1=%s id2=%s", verb, id1, id2
            )
            return build_simple_notice_card(
                "操作失败",
                "卡片操作执行失败，请查看后端日志或在 Web 端重试。",
                template="red",
            )

    # ── dispatch ────────────────────────────────────────────────

    async def _dispatch(
        self,
        verb: str,
        id1: str,
        id2: Optional[str],
        operator_id: str,
        chat_id: str,
        current_user: Optional[dict] = None,
    ) -> Optional[dict]:
        # —— Task 单 ID ——
        if verb == "task_stop":
            return await self._task_action(id1, action="stop", current_user=current_user)
        if verb == "task_approve":
            return await self._task_action(id1, action="approve", current_user=current_user)
        if verb == "task_reject":
            return await self._task_action(id1, action="reject", current_user=current_user)
        if verb == "task_retry":
            return await self._task_action(id1, action="retry", current_user=current_user)
        if verb == "task_refresh":
            return await self._build_task_card_or_notice(id1)
        if verb == "task_detail":
            return await self._build_task_detail_card(id1)

        # —— Plan 单 ID ——
        if verb == "plan_stop":
            denied = await self._check_plan_write(id1, current_user)
            if denied:
                return denied
            await plan_service.stop_plan(id1)
            return await self._build_plan_card_or_notice(id1)
        if verb == "plan_refresh":
            return await self._build_plan_card_or_notice(id1)
        if verb == "plan_detail":
            return await self._build_plan_card_or_notice(id1)
        if verb == "plan_retry_failed":
            denied = await self._check_plan_write(id1, current_user)
            if denied:
                return denied
            return await self._plan_retry_failed(id1)

        # —— Plan 子任务（双 ID）——
        if verb in ("plan_task_stop", "plan_task_cancel"):
            assert id2
            denied = await self._check_plan_write(id1, current_user)
            if denied:
                return denied
            await task_service.stop_task(id2)
            return await self._build_plan_card_or_notice(id1)
        if verb == "plan_task_retry":
            assert id2
            denied = await self._check_plan_write(id1, current_user)
            if denied:
                return denied
            await plan_service.retry_task(id1, id2)
            return await self._build_plan_card_or_notice(id1)
        if verb == "plan_task_detail":
            assert id2
            return await self._build_task_detail_card(id2)
        if verb == "plan_approve":
            assert id2
            denied = await self._check_plan_write(id1, current_user)
            if denied:
                return denied
            # 尝试通过 approval_service 审批（持久化流程）
            pending = await approval_service.get_pending_by_task(id2)
            if pending:
                await approval_service.approve(pending["id"])
            else:
                await task_service.approve_task(id2)
            return await self._build_plan_card_or_notice(id1)
        if verb == "plan_reject":
            assert id2
            denied = await self._check_plan_write(id1, current_user)
            if denied:
                return denied
            # 尝试通过 approval_service 拒绝（持久化流程）
            pending = await approval_service.get_pending_by_task(id2)
            if pending:
                await approval_service.reject(pending["id"])
            else:
                await task_service.reject_task(id2)
            return await self._build_plan_card_or_notice(id1)

        # —— Dashboard ——
        if verb == "dashboard_refresh":
            stats = await _aggregate_dashboard_stats(id1)
            return build_dashboard_card(stats)
        if verb == "dashboard_tasks":
            return await self._build_task_list_card(id1)
        if verb == "dashboard_plans":
            return await self._build_plan_list_card(id1)
        if verb == "dashboard_kanban":
            return build_simple_notice_card(
                "看板视图",
                "请在 Web 端打开看板：/kanban",
                template="blue",
                back_action=f"dashboard_refresh_{id1}",
                back_label="返回看板",
            )

        logger.warning("unhandled card action verb: %s", verb)
        return None

    # ── 任务动作 ─────────────────────────────────────────────────

    async def _task_action(
        self, task_id: str, action: str, current_user: Optional[dict] = None
    ) -> Optional[dict]:
        # 项目级写权限检查
        if TIDE_REQUIRE_AUTH and current_user:
            async with async_session_factory() as session:
                result = await session.execute(
                    text("SELECT cwd FROM tasks WHERE id = :tid LIMIT 1"),
                    {"tid": task_id},
                )
                row = result.fetchone()
            if row and row[0]:
                try:
                    await check_cwd_write_permission(row[0], current_user)
                except Exception:
                    return self._permission_denied_card("您没有该项目的操作权限")

        if action == "stop":
            await task_service.stop_task(task_id)
        elif action == "approve":
            # 尝试通过 approval_service 审批（持久化流程）
            pending = await approval_service.get_pending_by_task(task_id)
            if pending:
                await approval_service.approve(pending["id"])
            else:
                await task_service.approve_task(task_id)
        elif action == "reject":
            # 尝试通过 approval_service 拒绝（持久化流程）
            pending = await approval_service.get_pending_by_task(task_id)
            if pending:
                await approval_service.reject(pending["id"])
            else:
                await task_service.reject_task(task_id)
        elif action == "retry":
            await task_service.retry_task(task_id)
        return await self._build_task_card_or_notice(task_id)

    async def _build_task_card_or_notice(self, task_id: str) -> dict:
        task = await task_service.get_task(task_id)
        if not task:
            return build_simple_notice_card(
                "任务不存在",
                f"找不到任务 `{task_id[:8]}…`，可能已被删除。",
                template="red",
            )
        return build_task_card(task)

    async def _build_task_detail_card(self, task_id: str) -> dict:
        """详情卡片：复用 task 卡片（含完整字段）。"""
        return await self._build_task_card_or_notice(task_id)

    # ── Plan 动作 ────────────────────────────────────────────────

    async def _build_plan_card_or_notice(self, plan_id: str) -> dict:
        plan = await _load_plan_with_tasks(plan_id)
        if not plan:
            return build_simple_notice_card(
                "Plan 不存在",
                f"找不到 Plan `{plan_id[:8]}…`，可能已被删除。",
                template="red",
            )
        return build_plan_card(plan)

    async def _plan_retry_failed(self, plan_id: str) -> dict:
        """重试 Plan 中所有 failed/stopped/rejected 子任务。"""
        plan = await _load_plan_with_tasks(plan_id)
        if not plan:
            return build_simple_notice_card(
                "Plan 不存在",
                f"找不到 Plan `{plan_id[:8]}…`。",
                template="red",
            )
        retry_count = 0
        for task in plan.get("tasks", []):
            status = (task.get("status") or "").lower()
            if status in ("failed", "stopped", "rejected"):
                tid = str(task.get("id") or "")
                if tid:
                    await plan_service.retry_task(plan_id, tid)
                    retry_count += 1
        logger.info(
            "plan_retry_failed plan=%s retried=%d", plan_id[:8], retry_count
        )
        return await self._build_plan_card_or_notice(plan_id)

    # ── 权限辅助 ──────────────────────────────────────────────────

    def _permission_denied_card(self, message: str) -> dict:
        """返回权限不足的提示 toast。"""
        return {
            "toast": {
                "type": "warning",
                "content": f"⚠️ {message}",
            }
        }

    async def _check_plan_write(
        self, plan_id: str, current_user: Optional[dict]
    ) -> Optional[dict]:
        """检查 plan 的项目级写权限，无权限返回提示卡片，否则返回 None。"""
        if not TIDE_REQUIRE_AUTH or not current_user:
            return None
        async with async_session_factory() as session:
            result = await session.execute(
                text("SELECT cwd FROM plans WHERE id = :pid LIMIT 1"),
                {"pid": plan_id},
            )
            row = result.fetchone()
        if row and row[0]:
            try:
                await check_cwd_write_permission(row[0], current_user)
            except Exception:
                return self._permission_denied_card("您没有该项目的操作权限")
        return None

    # ── Dashboard 子视图 ─────────────────────────────────────────

    async def _build_task_list_card(self, workspace_id: str) -> dict:
        """简易任务列表视图（最多 10 条）。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, status, agent_id, prompt
                    FROM tasks WHERE workspace_id = :ws
                    ORDER BY created_at DESC LIMIT 10
                    """
                ),
                {"ws": workspace_id},
            )
            rows = [dict(row._mapping) for row in result.fetchall()]

        if not rows:
            body = "暂无任务。"
        else:
            lines = []
            for r in rows:
                tid = str(r.get("id") or "")[:8]
                status = r.get("status") or "-"
                agent = r.get("agent_id") or "-"
                prompt = (r.get("prompt") or "").replace("\n", " ")
                if len(prompt) > 60:
                    prompt = prompt[:60] + "…"
                lines.append(f"- `{tid}` · {status} · {agent} · {prompt}")
            body = "\n".join(lines)

        return build_simple_notice_card(
            "最近任务",
            body,
            template="blue",
            back_action=f"dashboard_refresh_{workspace_id}",
            back_label="返回看板",
        )

    async def _build_plan_list_card(self, workspace_id: str) -> dict:
        """简易 Plan 列表视图（最多 10 条）。"""
        plans = await plan_service.list_plans(workspace_id=workspace_id, limit=10)
        if not plans:
            body = "暂无 Plan。"
        else:
            lines = []
            for p in plans:
                pid = str(p.get("id") or "")[:8]
                status = p.get("status") or "-"
                cwd = p.get("cwd") or "-"
                lines.append(f"- `{pid}` · {status} · `{cwd}`")
            body = "\n".join(lines)

        return build_simple_notice_card(
            "最近 Plan",
            body,
            template="blue",
            back_action=f"dashboard_refresh_{workspace_id}",
            back_label="返回看板",
        )


# 全局单例
card_action_handler = CardActionHandler()


__all__ = [
    "CardActionHandler",
    "card_action_handler",
    "parse_action_value",
]
