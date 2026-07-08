"""
无工作流自由协作模式服务。

处理 freeform 模式下的工作项分配、Squad Leader 调度、状态管理和共享上下文：
- 分配：直接分配给成员 / 专家团 / 小队（Squad 自动识别 Leader）
- 调度：Squad Leader 派遣任务给小队成员
- 状态：pending → accepted → in_progress → completed（或 pending → declined）
- 共享上下文：summary / decision / progress / handover 时间序流

依赖：
- work_item_assignments 表（分配记录）
- work_item_context 表（共享上下文）
- expert_team_service（专家团/Squad 解析）
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.expert_team_service import expert_team_service
from backend.services.ws_hub import ws_hub

logger = logging.getLogger(__name__)


# 合法状态流转：pending → accepted → in_progress → completed；pending → declined
VALID_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"accepted", "declined"},
    "accepted": {"in_progress", "declined"},
    "in_progress": {"completed", "declined"},
    "completed": set(),
    "declined": set(),
}

VALID_CONTEXT_TYPES = {"summary", "decision", "progress", "handover"}


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


def _assignment_to_dict(row) -> dict:
    r = dict(row._mapping)
    r["dispatched_to"] = _safe_json_loads(r.get("dispatched_to"), [])
    return r


# 后台任务强引用集合：asyncio 事件循环仅持有 task 的弱引用，
# 若不保留强引用，长时间运行的后台任务可能在执行中途被 GC 回收，
# 导致 _watch_comment_task 轮询提前中断、task_status 卡在 running。
_BACKGROUND_TASKS: set = set()


def _spawn_background(coro) -> asyncio.Task:
    """创建后台任务并保留强引用，完成后自动移除，避免被提前 GC。"""
    task = asyncio.create_task(coro)
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return task


class NoWorkflowService:
    """自由协作模式下的工作项生命周期管理。"""

    # ── 分配 ──────────────────────────────────────────────

    async def assign_to_member(
        self,
        work_item_id: str,
        member_id: str,
        assigned_by: str,
        role: str = "executor",
    ) -> dict:
        """直接分配给成员。创建 assignment 记录并广播事件。"""
        return await self._create_assignment(
            work_item_id=work_item_id,
            target_type="member",
            target_id=member_id,
            assigned_by=assigned_by,
            role=role,
        )

    async def assign_to_expert_team(
        self, work_item_id: str, team_id: str, assigned_by: str
    ) -> dict:
        """分配给专家团。"""
        team = await expert_team_service.get_expert_team(team_id)
        if not team:
            raise ValueError(f"Expert team not found: {team_id}")
        return await self._create_assignment(
            work_item_id=work_item_id,
            target_type="expert_team",
            target_id=team_id,
            assigned_by=assigned_by,
            role="executor",
        )

    async def assign_to_squad(
        self, work_item_id: str, squad_id: str, assigned_by: str
    ) -> dict:
        """分配给小队。自动识别 leader 并通知。"""
        team = await expert_team_service.get_expert_team(squad_id)
        if not team:
            raise ValueError(f"Squad not found: {squad_id}")
        if not team.get("is_squad"):
            raise ValueError(f"Expert team {squad_id} is not a squad")

        # Leader 由 leader_strategy 决定
        leader_strategy = team.get("leader_strategy") or "capability_match"
        leader = self._resolve_squad_leader(team, leader_strategy)

        assignment = await self._create_assignment(
            work_item_id=work_item_id,
            target_type="squad",
            target_id=squad_id,
            assigned_by=assigned_by,
            role="leader",
            broadcast=False,
        )

        await ws_hub.broadcast(
            "work_items",
            {
                "type": "work_item.assigned",
                "work_item_id": work_item_id,
                "assignment_id": assignment["id"],
                "target_type": "squad",
                "target_id": squad_id,
                "leader": leader,
                "leader_strategy": leader_strategy,
            },
        )
        logger.info(
            "Work item %s assigned to squad %s (leader=%s)",
            work_item_id,
            squad_id,
            (leader or {}).get("agent_id"),
        )
        return assignment

    def _resolve_squad_leader(self, team: dict, strategy: str) -> Optional[dict]:
        """根据 leader_strategy 从 Squad 成员中确定 Leader。"""
        members = _safe_json_loads(team.get("member_agents"), [])
        if not members:
            return None
        # 复用 expert_team_service 的成员选择逻辑
        return expert_team_service._select_squad_member(members, strategy)

    async def _create_assignment(
        self,
        work_item_id: str,
        target_type: str,
        target_id: str,
        assigned_by: str,
        role: str = "executor",
        broadcast: bool = True,
    ) -> dict:
        """创建一条 assignment 记录（内部通用方法）。"""
        assignment_id = str(uuid.uuid4())
        now = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO work_item_assignments
                        (id, work_item_id, target_type, target_id, role, status,
                         assigned_by, dispatched_to, notes, created_at, updated_at)
                    VALUES (:id, :work_item_id, :target_type, :target_id, :role,
                            'pending', :assigned_by, NULL, NULL, :created_at, :updated_at)
                    """
                ),
                {
                    "id": assignment_id,
                    "work_item_id": work_item_id,
                    "target_type": target_type,
                    "target_id": target_id,
                    "role": role,
                    "assigned_by": assigned_by,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        assignment = await self._get_assignment(assignment_id)
        if broadcast:
            await ws_hub.broadcast(
                "work_items",
                {
                    "type": "work_item.assigned",
                    "work_item_id": work_item_id,
                    "assignment_id": assignment_id,
                    "target_type": target_type,
                    "target_id": target_id,
                },
            )
            logger.info(
                "Work item %s assigned to %s:%s",
                work_item_id,
                target_type,
                target_id,
            )
        # 工作项被分配给成员 → 通知被分配者（不通知自己）
        if target_type == "member" and target_id and target_id != assigned_by:
            try:
                from backend.services.notification_service import notification_service

                wi_title = await self._get_work_item_title(work_item_id)
                await notification_service.create_notification(
                    recipient_id=target_id,
                    work_item_id=work_item_id,
                    notification_type="assigned",
                    trigger_actor_id=assigned_by,
                    content=f"您被分配了工作项「{wi_title}」",
                )
            except Exception:
                logger.debug("create assigned notification failed", exc_info=True)

        return assignment  # type: ignore[return-value]

    # ── Squad Leader 调度 ─────────────────────────────────

    async def dispatch_to_members(
        self,
        work_item_id: str,
        assignment_id: str,
        member_ids: list,
        leader_id: str,
    ) -> list:
        """Leader 派遣任务给小队成员。

        验证 leader 身份，为每个 member 创建子 assignment，
        更新父 assignment 的 dispatched_to 字段，并广播事件。
        """
        parent = await self._get_assignment(assignment_id)
        if not parent:
            raise ValueError(f"Assignment not found: {assignment_id}")
        if parent["work_item_id"] != work_item_id:
            raise ValueError(
                f"Assignment {assignment_id} does not belong to work item {work_item_id}"
            )

        # 验证 leader 身份：调度者必须是该 assignment 的负责人（assigned_by 或 target_id）
        if leader_id not in (parent.get("assigned_by"), parent.get("target_id")):
            raise PermissionError(
                f"User {leader_id} is not the leader of assignment {assignment_id}"
            )

        children: list[dict] = []
        for member_id in member_ids:
            child = await self._create_assignment(
                work_item_id=work_item_id,
                target_type="member",
                target_id=member_id,
                assigned_by=leader_id,
                role="executor",
                broadcast=False,
            )
            children.append(child)

        # 更新父 assignment 的 dispatched_to
        now = _now_iso()
        dispatched_json = json.dumps(list(member_ids), ensure_ascii=False)
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    UPDATE work_item_assignments
                    SET dispatched_to = :dispatched_to, updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                {
                    "dispatched_to": dispatched_json,
                    "updated_at": now,
                    "id": assignment_id,
                },
            )
            await session.commit()

        await ws_hub.broadcast(
            "work_items",
            {
                "type": "work_item.dispatch_started",
                "work_item_id": work_item_id,
                "assignment_id": assignment_id,
                "leader_id": leader_id,
                "member_ids": list(member_ids),
                "child_assignment_ids": [c["id"] for c in children],
            },
        )
        logger.info(
            "Leader %s dispatched work item %s to %d members",
            leader_id,
            work_item_id,
            len(children),
        )
        return children

    # ── 状态管理 ──────────────────────────────────────────

    async def accept_assignment(self, assignment_id: str, user_id: str) -> dict:
        """接受分配任务。pending → accepted。"""
        return await self._transition_status(
            assignment_id, "accepted", operator=user_id
        )

    async def update_progress(
        self, assignment_id: str, status: str, notes: str = None
    ) -> dict:
        """更新分配状态。"""
        return await self._transition_status(assignment_id, status, notes=notes)

    async def complete_assignment(
        self, assignment_id: str, user_id: str, output: str = None
    ) -> dict:
        """完成分配。in_progress → completed。"""
        return await self._transition_status(
            assignment_id, "completed", notes=output, operator=user_id
        )

    async def _transition_status(
        self,
        assignment_id: str,
        new_status: str,
        notes: str = None,
        operator: str = None,
    ) -> dict:
        """执行状态流转并校验合法性。"""
        assignment = await self._get_assignment(assignment_id)
        if not assignment:
            raise ValueError(f"Assignment not found: {assignment_id}")

        old_status = assignment.get("status") or "pending"
        allowed = VALID_STATUS_TRANSITIONS.get(old_status, set())
        if new_status not in allowed:
            raise ValueError(
                f"Invalid status transition: {old_status} → {new_status}"
            )

        now = _now_iso()
        params: dict = {
            "status": new_status,
            "updated_at": now,
            "id": assignment_id,
        }
        set_clause = "status = :status, updated_at = :updated_at"
        if notes is not None:
            set_clause += ", notes = :notes"
            params["notes"] = notes

        async with async_session_factory() as session:
            await session.execute(
                text(
                    f"UPDATE work_item_assignments SET {set_clause} WHERE id = :id"
                ),
                params,
            )
            await session.commit()

        updated = await self._get_assignment(assignment_id)
        await ws_hub.broadcast(
            "work_items",
            {
                "type": "assignment.status_changed",
                "work_item_id": assignment["work_item_id"],
                "assignment_id": assignment_id,
                "from_status": old_status,
                "to_status": new_status,
                "operator": operator,
            },
        )
        logger.info(
            "Assignment %s status: %s → %s",
            assignment_id,
            old_status,
            new_status,
        )
        return updated  # type: ignore[return-value]

    # ── 共享上下文 ────────────────────────────────────────

    async def add_context(
        self,
        work_item_id: str,
        context_type: str,
        content: str,
        author_id: str,
    ) -> dict:
        """添加共享上下文条目（summary/decision/progress/handover）。"""
        if context_type not in VALID_CONTEXT_TYPES:
            raise ValueError(f"Invalid context_type: {context_type}")

        context_id = str(uuid.uuid4())
        now = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO work_item_context
                        (id, work_item_id, context_type, content, author_id, created_at)
                    VALUES (:id, :work_item_id, :context_type, :content, :author_id, :created_at)
                    """
                ),
                {
                    "id": context_id,
                    "work_item_id": work_item_id,
                    "context_type": context_type,
                    "content": content,
                    "author_id": author_id,
                    "created_at": now,
                },
            )
            await session.commit()

        entry = {
            "id": context_id,
            "work_item_id": work_item_id,
            "context_type": context_type,
            "content": content,
            "author_id": author_id,
            "created_at": now,
        }
        await ws_hub.broadcast(
            "work_items",
            {
                "type": "work_item.context_updated",
                "work_item_id": work_item_id,
                "context_id": context_id,
                "context_type": context_type,
                "author_id": author_id,
            },
        )
        logger.info(
            "Context added to work item %s: %s by %s",
            work_item_id,
            context_type,
            author_id,
        )
        return entry

    async def get_context_stream(self, work_item_id: str) -> list:
        """获取工作项的完整上下文流（时间正序）。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, work_item_id, context_type, content, author_id, created_at
                    FROM work_item_context
                    WHERE work_item_id = :work_item_id
                    ORDER BY created_at ASC
                    """
                ),
                {"work_item_id": work_item_id},
            )
            rows = result.fetchall()
        return [dict(r._mapping) for r in rows]

    # ── 查询 ──────────────────────────────────────────────

    async def get_assignments(self, work_item_id: str) -> list:
        """获取工作项的所有分配记录。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, work_item_id, target_type, target_id, role, status,
                           assigned_by, dispatched_to, notes, created_at, updated_at
                    FROM work_item_assignments
                    WHERE work_item_id = :work_item_id
                    ORDER BY created_at ASC
                    """
                ),
                {"work_item_id": work_item_id},
            )
            rows = result.fetchall()
        return [_assignment_to_dict(r) for r in rows]

    async def get_my_assignments(self, user_id: str, status: str = None) -> list:
        """获取用户的所有分配（可选按状态过滤）。"""
        conditions = ["target_id = :user_id"]
        params: dict = {"user_id": user_id}
        if status is not None:
            conditions.append("status = :status")
            params["status"] = status
        where = " AND ".join(conditions)
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT id, work_item_id, target_type, target_id, role, status,
                           assigned_by, dispatched_to, notes, created_at, updated_at
                    FROM work_item_assignments
                    WHERE {where}
                    ORDER BY updated_at DESC
                    """
                ),
                params,
            )
            rows = result.fetchall()
        return [_assignment_to_dict(r) for r in rows]

    # ── 内部辅助 ──────────────────────────────────────────

    async def _get_assignment(self, assignment_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, work_item_id, target_type, target_id, role, status,
                           assigned_by, dispatched_to, notes, created_at, updated_at
                    FROM work_item_assignments
                    WHERE id = :id
                    """
                ),
                {"id": assignment_id},
            )
            row = result.fetchone()
        return _assignment_to_dict(row) if row else None

    # ── 评论协作（freeform 核心交互） ──

    @staticmethod
    def _decode_project_path(project_id: str) -> Optional[str]:
        """project_id = base64.urlsafe(cwd)，解码为项目绝对路径。"""
        if not project_id:
            return None
        try:
            import base64
            padded = project_id + "=" * (-len(project_id) % 4)
            path = base64.urlsafe_b64decode(padded).decode()
            if path and os.path.isabs(path):
                return path
        except Exception:
            return None
        return None

    async def _get_work_item(self, work_item_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, project_id, title, description, group_id "
                    "FROM work_items WHERE id = :id"
                ),
                {"id": work_item_id},
            )
            row = result.fetchone()
        return dict(row._mapping) if row else None

    async def _get_work_item_title(self, work_item_id: str) -> str:
        """查询工作项标题，缺失时回退为 work_item_id。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("SELECT title FROM work_items WHERE id = :id"),
                {"id": work_item_id},
            )
            row = result.fetchone()
        title = dict(row._mapping).get("title") if row else None
        return title or work_item_id

    async def create_comment(
        self,
        work_item_id: str,
        author_id: str,
        content: str,
        mentions: Optional[list] = None,
    ) -> dict:
        """写入一条评论记录。"""
        comment_id = str(uuid.uuid4())
        now = _now_iso()
        mentions_json = (
            json.dumps(mentions, ensure_ascii=False) if mentions else None
        )
        async with async_session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO work_item_comments
                        (id, work_item_id, author_id, content, mentions,
                         task_id, task_status, created_at)
                    VALUES (:id, :work_item_id, :author_id, :content, :mentions,
                            NULL, NULL, :created_at)
                    """
                ),
                {
                    "id": comment_id,
                    "work_item_id": work_item_id,
                    "author_id": author_id,
                    "content": content,
                    "mentions": mentions_json,
                    "created_at": now,
                },
            )
            await session.commit()
        return await self.get_comment(comment_id)  # type: ignore[return-value]

    async def get_comment(self, comment_id: str) -> Optional[dict]:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT c.id, c.work_item_id, c.author_id, c.content, "
                    "c.mentions, c.task_id, c.task_status, c.created_at, "
                    "COALESCE(u.display_name, u.username) AS author_name "
                    "FROM work_item_comments c "
                    "LEFT JOIN users u ON c.author_id = u.id "
                    "WHERE c.id = :id"
                ),
                {"id": comment_id},
            )
            row = result.fetchone()
        if not row:
            return None
        r = dict(row._mapping)
        r["mentions"] = _safe_json_loads(r.get("mentions"), [])
        return r

    async def get_comments(self, work_item_id: str) -> list:
        """获取工作项评论列表（时间正序）。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT c.id, c.work_item_id, c.author_id, c.content, "
                    "c.mentions, c.task_id, c.task_status, c.created_at, "
                    "COALESCE(u.display_name, u.username) AS author_name "
                    "FROM work_item_comments c "
                    "LEFT JOIN users u ON c.author_id = u.id "
                    "WHERE c.work_item_id = :work_item_id "
                    "ORDER BY c.created_at ASC"
                ),
                {"work_item_id": work_item_id},
            )
            rows = result.fetchall()
        out = []
        for row in rows:
            r = dict(row._mapping)
            r["mentions"] = _safe_json_loads(r.get("mentions"), [])
            out.append(r)
        return out

    async def update_comment_task(
        self,
        comment_id: str,
        task_id: Optional[str] = None,
        task_status: Optional[str] = None,
    ) -> Optional[dict]:
        """更新评论关联任务的 id / 状态，并广播更新后的评论。"""
        sets = []
        params: dict = {"id": comment_id}
        if task_id is not None:
            sets.append("task_id = :task_id")
            params["task_id"] = task_id
        if task_status is not None:
            sets.append("task_status = :task_status")
            params["task_status"] = task_status
        if sets:
            async with async_session_factory() as session:
                await session.execute(
                    text(
                        f"UPDATE work_item_comments SET {', '.join(sets)} WHERE id = :id"
                    ),
                    params,
                )
                await session.commit()
        comment = await self.get_comment(comment_id)
        if comment:
            try:
                from backend.services.event_emitter import event_emitter
                await event_emitter.emit_work_item_comment_updated(
                    comment["work_item_id"], comment
                )
            except Exception:
                logger.debug("emit_work_item_comment_updated failed", exc_info=True)
        return comment

    async def execute_from_comment(
        self,
        work_item_id: str,
        comment_id: str,
        mention: dict,
        prompt: str,
    ) -> Optional[str]:
        """@mention 专家团/小队 → 触发 Agent CLI 执行。"""
        from backend.services.task_service import task_service

        team_id = mention.get("id")
        if not team_id:
            return None

        resolved = await expert_team_service.resolve_squad(team_id, "default")
        if not resolved:
            logger.warning("execute_from_comment: mention %s not resolvable", team_id)
            return None

        agent_id = resolved.get("agent_id") or "codex"
        model = resolved.get("model") or None
        role_prompt = resolved.get("role_prompt") or ""

        item = await self._get_work_item(work_item_id)
        title = (item or {}).get("title") or ""
        description = (item or {}).get("description") or ""

        context_stream = await self.get_context_stream(work_item_id)
        recent = context_stream[:5]

        parts: list[str] = []
        if role_prompt:
            parts.append(f"# 你的角色\n\n{role_prompt}")
        parts.append(f"# 工作项\n\n标题：{title}")
        if description:
            parts.append(f"描述：\n{description}")
        if recent:
            ctx_lines = "\n".join(
                f"- [{c.get('context_type')}] {c.get('content')}" for c in recent
            )
            parts.append(f"# 共享上下文\n\n{ctx_lines}")
        parts.append(f"# 协作请求\n\n{prompt}")
        full_prompt = "\n\n".join(parts)

        cwd = ""
        if item:
            cwd = self._decode_project_path(item.get("project_id")) or ""

        try:
            task = await task_service.create_task(
                workspace_id="default",
                prompt=full_prompt,
                agent_id=agent_id,
                model=model or "",
                cwd=cwd,
                full_auto=True,
            )
        except Exception as exc:
            logger.error("execute_from_comment create_task failed: %s", exc, exc_info=True)
            return None

        task_id = task.get("id") if task else None
        if not task_id:
            return None

        await self.update_comment_task(comment_id, task_id=task_id, task_status="running")
        _spawn_background(
            self._watch_comment_task(work_item_id, comment_id, task_id)
        )
        logger.info(
            "execute_from_comment: work_item=%s comment=%s task=%s agent=%s",
            work_item_id, comment_id, task_id, agent_id,
        )
        return task_id

    async def _get_task_output(self, task_id: str) -> str:
        """获取 task 的最终输出：优先 agent_final_output，其次 result。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT agent_final_output, result FROM tasks WHERE id = :id"
                ),
                {"id": task_id},
            )
            row = result.fetchone()
        if not row:
            return ""
        r = dict(row._mapping)
        return (r.get("agent_final_output") or r.get("result") or "").strip()

    def _extract_task_summary(self, output: str) -> str:
        """提取 task 输出摘要，用于注入共享上下文（限制 2000 字符）。"""
        if not output:
            return "（无输出）"
        max_len = 2000
        if len(output) > max_len:
            return "..." + output[-max_len:]
        return output

    async def _inject_task_result_context(
        self, work_item_id: str, task_id: str, success: bool
    ):
        """将 task 执行结果摘要注入工作项共享上下文并广播事件。"""
        from backend.services.event_emitter import event_emitter

        try:
            output = await self._get_task_output(task_id)
            summary = self._extract_task_summary(output)
            if success:
                content = f"[Agent 执行完成] {summary}"
            else:
                content = f"[Agent 执行失败] {summary}"
            await self.add_context(
                work_item_id=work_item_id,
                context_type="progress",
                content=content,
                author_id="system",
            )
            await event_emitter.emit_work_item_context_updated(
                work_item_id, "progress", "system"
            )
        except Exception:
            logger.warning(
                "_inject_task_result_context failed for task %s",
                task_id,
                exc_info=True,
            )

    async def _notify_comment_author(
        self, comment_id: str, work_item_id: str, success: bool = True
    ):
        """Agent 任务结束后通知评论发起人（失败不影响主流程）。"""
        try:
            from backend.services.notification_service import notification_service

            async with async_session_factory() as session:
                result = await session.execute(
                    text(
                        "SELECT author_id FROM work_item_comments WHERE id = :cid"
                    ),
                    {"cid": comment_id},
                )
                row = result.fetchone()
            author_id = dict(row._mapping).get("author_id") if row else None
            if not author_id:
                return
            wi_title = await self._get_work_item_title(work_item_id)
            status_text = "已完成" if success else "已结束"
            await notification_service.create_notification(
                recipient_id=author_id,
                work_item_id=work_item_id,
                notification_type="task_completed",
                trigger_actor_id="system",
                content=f"您发起的 Agent 任务{status_text}（工作项「{wi_title}」）",
            )
        except Exception:
            logger.debug("notify comment author failed", exc_info=True)

    async def _watch_comment_task(
        self, work_item_id: str, comment_id: str, task_id: str
    ):
        """后台轮询评论关联任务：更新 task_status，阻塞时发射 blocked 事件。"""
        from backend.services.event_emitter import event_emitter

        blocked = False
        for _ in range(3600):
            await asyncio.sleep(2)
            async with async_session_factory() as session:
                result = await session.execute(
                    text("SELECT status FROM tasks WHERE id = :id"),
                    {"id": task_id},
                )
                row = result.fetchone()
            if not row:
                return
            status = (dict(row._mapping).get("status") or "").lower()

            async with async_session_factory() as session:
                result = await session.execute(
                    text(
                        "SELECT COUNT(*) AS c FROM approvals "
                        "WHERE task_id = :id AND status = 'pending'"
                    ),
                    {"id": task_id},
                )
                prow = result.fetchone()
            has_pending = bool(prow and dict(prow._mapping).get("c", 0) > 0)

            terminal = status in ("completed", "failed", "stopped", "rejected", "cancelled")
            if has_pending and not blocked:
                blocked = True
                await self.update_comment_task(comment_id, task_status="blocked")
                await event_emitter.emit_work_item_blocked(work_item_id, "Agent 请求审批")
            elif not has_pending and blocked and not terminal:
                blocked = False
                await self.update_comment_task(comment_id, task_status="running")
                await event_emitter.emit_work_item_unblocked(work_item_id)

            if status == "completed":
                await self.update_comment_task(comment_id, task_status="completed")
                if blocked:
                    await event_emitter.emit_work_item_unblocked(work_item_id)
                await self._inject_task_result_context(
                    work_item_id, task_id, success=True
                )
                await self._notify_comment_author(
                    comment_id, work_item_id, success=True
                )
                return
            if status in ("failed", "stopped", "rejected", "cancelled"):
                await self.update_comment_task(comment_id, task_status=status)
                if blocked:
                    await event_emitter.emit_work_item_unblocked(work_item_id)
                await self._inject_task_result_context(
                    work_item_id, task_id, success=False
                )
                await self._notify_comment_author(
                    comment_id, work_item_id, success=False
                )
                return
        logger.warning("_watch_comment_task timed out for task %s", task_id)


# 模块级单例
no_workflow_service = NoWorkflowService()
