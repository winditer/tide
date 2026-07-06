"""
MessageHandler: Lark 消息指令处理器

消费 LarkListener 产生的事件，解析指令，调用对应 Service 处理。
当前支持的指令（精简版）：
- 纯文本 → 创建任务
- /stop → 停止当前任务
- /status → 查询状态
- /plan → 创建 Plan（基础版）
- /agent=xxx → 切换 Agent
- /model=xxx → 指定模型
"""

import asyncio
import logging
import re
import time
from typing import Any, Optional

from sqlalchemy import text as sa_text

from backend.db.engine import async_session_factory
from backend.services.lark_listener import LarkEvent
from backend.services.lark_bridge import lark_bridge
from backend.services.conversation_service import conversation_service
from backend.core.dependencies import (
    check_lark_permission,
    LarkPermissionDenied,
    get_accessible_project_ids,
    check_cwd_write_permission,
    check_project_write_permission,
    encode_project_id,
)
from backend.runtime.config import TIDE_REQUIRE_AUTH, LARK_ALLOWED_OPEN_IDS

logger = logging.getLogger("tide.message_handler")

# 待处理附件暂存：key = f"{chat_id}:{sender_id}"
# value = {"attachments": [<dict>...], "timestamp": <epoch_seconds>}
_PENDING_ATTACHMENTS: dict[str, dict] = {}
_PENDING_ATTACHMENTS_TTL_SECONDS: float = 60.0


def _pending_key(chat_id: str, sender_id: str) -> str:
    return f"{chat_id}:{sender_id or 'unknown'}"


def _prune_pending_attachments(now: Optional[float] = None) -> None:
    """清除超过 TTL 的暂存附件。"""
    current = now if now is not None else time.time()
    expired = [
        k for k, v in _PENDING_ATTACHMENTS.items()
        if current - float(v.get("timestamp", 0) or 0) > _PENDING_ATTACHMENTS_TTL_SECONDS
    ]
    for k in expired:
        _PENDING_ATTACHMENTS.pop(k, None)


class MessageHandler:
    """Lark 消息处理器"""

    def __init__(self):
        self._task_service = None  # lazy import 避免循环依赖
        self._running = False
        self._consumer_task: Optional[asyncio.Task] = None
        self._seen_message_ids: set[str] = set()  # 防止 ws 重连后重复创建任务
        self._boot_time_ms: int = int(time.time() * 1000)  # 毫秒级启动时间
        self._dedup_loaded: bool = False  # 标记是否已从 DB 加载历史 message_id

    async def _ensure_dedup_loaded(self):
        """首次调用时从 DB 加载近期 message_id 到内存去重集合，避免重启后重复创建任务"""
        if self._dedup_loaded:
            return
        self._dedup_loaded = True
        try:
            async with async_session_factory() as session:
                result = await session.execute(sa_text(
                    "SELECT source_message_id FROM tasks "
                    "WHERE source_message_id IS NOT NULL "
                    "AND created_at > datetime('now', '-24 hours')"
                ))
                for row in result.fetchall():
                    self._seen_message_ids.add(row[0])
            logger.info("[message_handler] Loaded %d seen message_ids from DB", len(self._seen_message_ids))
        except Exception:
            logger.debug("[message_handler] Failed to load seen message_ids", exc_info=True)

    @property
    def task_service(self):
        if self._task_service is None:
            from backend.services.task_service import task_service
            self._task_service = task_service
        return self._task_service

    async def start(self, event_queue: asyncio.Queue):
        """启动事件消费循环"""
        self._running = True
        self._consumer_task = asyncio.create_task(self._consume_loop(event_queue))
        logger.info("MessageHandler started")

    async def stop(self):
        """停止消费循环"""
        self._running = False
        if self._consumer_task:
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass
        logger.info("MessageHandler stopped")

    async def _consume_loop(self, queue: asyncio.Queue):
        """持续消费 Lark 事件队列"""
        while self._running:
            try:
                event: LarkEvent = await asyncio.wait_for(queue.get(), timeout=1.0)
                await self._handle_event(event)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error handling Lark event")

    async def _handle_event(self, event: LarkEvent):
        """分发事件到对应处理器"""
        if event.event_type == "text_message":
            await self._handle_text_message(event)
        elif event.event_type == "card_action":
            await self._handle_card_action(event)
        else:
            logger.debug("Unknown event type: %s", event.event_type)

    async def _handle_text_message(self, event: LarkEvent):
        """处理文本消息"""
        content = (event.content or "").strip()
        chat_id = event.chat_id
        sender_id = event.sender_id  # Lark open_id

        # === 权限前置检查 ===
        # 白名单检查
        if LARK_ALLOWED_OPEN_IDS and sender_id not in LARK_ALLOWED_OPEN_IDS:
            # 静默忽略非白名单用户，不回复
            return

        # 身份解析（仅在认证模式下强制）
        current_user: Optional[dict] = None
        if TIDE_REQUIRE_AUTH:
            try:
                current_user = await check_lark_permission(sender_id)
            except LarkPermissionDenied as e:
                if e.reason == "user_not_bound":
                    await lark_bridge.send_text(chat_id, "⚠️ 您的飞书账号尚未绑定 Tide 系统，请先通过 Web 端登录绑定。")
                elif e.reason == "user_disabled":
                    await lark_bridge.send_text(chat_id, "⚠️ 您的账号已被禁用，无法执行操作。")
                else:
                    await lark_bridge.send_text(chat_id, "⚠️ 权限不足，无法执行操作。")
                return
        else:
            # 非强制认证模式下，尝试解析但不阻止
            from backend.core.dependencies import resolve_lark_user
            current_user = await resolve_lark_user(sender_id)

        # 附件仅消息：暂存并提示用户发送指令使用
        if event.attachments and not content:
            _prune_pending_attachments()
            key = _pending_key(event.chat_id, event.sender_id)
            _PENDING_ATTACHMENTS[key] = {
                "attachments": list(event.attachments),
                "timestamp": time.time(),
            }
            logger.info(
                "Lark attachments stashed: chat=%s sender=%s count=%d",
                chat_id[:8] if chat_id else "-",
                (event.sender_id or "")[:8],
                len(event.attachments),
            )
            try:
                await lark_bridge.send_text(
                    chat_id, "✅ 已收到附件，请发送指令来使用它"
                )
            except Exception:
                logger.exception("failed to send attachment ack")
            return

        if not content:
            return

        logger.info(
            "Received message from chat=%s: %s",
            chat_id[:8] if chat_id else "-",
            content[:50],
        )

        # 解析指令前缀
        # /help — 显示帮助信息
        if content.lower().startswith("/help"):
            await self._cmd_help(chat_id)
            return

        # /mark-project — 标记项目路径
        if content.startswith("/mark-project"):
            path_arg = content[len("/mark-project"):].strip()
            await self._cmd_mark_project(chat_id, path_arg)
            return

        # /mark-chat — 标记聊天会话
        if content.startswith("/mark-chat"):
            session_arg = content[len("/mark-chat"):].strip()
            await self._cmd_mark_chat(chat_id, session_arg)
            return

        # /stop — 停止当前任务
        if content.lower().startswith("/stop"):
            await self._cmd_stop(chat_id, content)
            return

        # /status — 查询状态
        if content.lower().startswith("/status"):
            await self._cmd_status(chat_id)
            return

        # /plan — 创建 Plan（预留）
        if content.lower().startswith("/plan"):
            await self._cmd_plan(chat_id, content, current_user=current_user)
            return

        # /projects, /项目 — 项目面板
        if content in ("/projects", "/项目", "/projects 展开", "/项目 展开"):
            expanded = "展开" in content
            await self._cmd_projects(chat_id, expanded=expanded, current_user=current_user)
            return

        # /chats, /普通对话 — 对话列表
        if content in ("/chats", "/普通对话", "/chats 收起", "/普通对话 收起"):
            expanded = "收起" not in content
            await self._cmd_chats(chat_id, expanded=expanded, current_user=current_user)
            return

        # /convos, /对话 — 当前项目会话
        if content in ("/convos", "/对话", "/convos 展开", "/对话 展开"):
            expanded = "展开" in content
            await self._cmd_convos(chat_id, expanded=expanded, current_user=current_user)
            return

        # /conv <id> — 选择会话
        if content.startswith("/conv "):
            await self._cmd_conv(chat_id, content[6:].strip())
            return

        # /project <n> — 打开项目
        if content.startswith("/project "):
            await self._cmd_project_by_number(chat_id, content[9:].strip())
            return

        # /latest <n> — 最新会话
        if content.startswith("/latest "):
            await self._cmd_latest_by_number(chat_id, content[8:].strip())
            return

        # Plan 输入模式：非命令文本直接作为 Plan 任务列表
        if not content.startswith("/"):
            from backend.services.chat_state import get_chat_state
            state = await get_chat_state(chat_id)
            if state.plan_input_mode:
                await self._plan_create(chat_id, content, current_user=current_user)
                return

        # /agent=xxx — 切换 Agent
        agent_match = re.match(r"^/agent[=\s]+(\w+)", content, re.IGNORECASE)
        if agent_match:
            await self._cmd_set_agent(chat_id, agent_match.group(1))
            return

        # /model=xxx — 指定模型
        model_match = re.match(r"^/model[=\s]+(.+)", content, re.IGNORECASE)
        if model_match:
            await self._cmd_set_model(chat_id, model_match.group(1).strip())
            return

        # /workflow run <id> | /workflow list — 工作流触发
        if content.lower().startswith("/workflow"):
            await self._cmd_workflow(chat_id, content, current_user=current_user)
            return

        # /wi create|list|move — 工作项管理
        if content.lower().startswith("/wi ") or content.lower() == "/wi":
            await self._cmd_work_item(chat_id, content, current_user=current_user)
            return

        # /daily — 每日进度报告
        if content.lower().startswith("/daily"):
            await self._cmd_daily(chat_id, content, current_user=current_user)
            return

        # /agents — 查看可用 Agent 列表
        if content.lower().startswith("/agents"):
            await self._cmd_agents(chat_id)
            return

        # /approve <id> — 批准审批
        if content.startswith("/approve "):
            await self._cmd_approve(chat_id, content[9:].strip(), approved=True)
            return

        # /reject <id> — 拒绝审批
        if content.startswith("/reject "):
            await self._cmd_reject(chat_id, content[8:].strip())
            return

        # /cancel <id> — 取消排队任务
        if content.startswith("/cancel "):
            await self._cmd_cancel(chat_id, content[8:].strip())
            return

        # /panel, /projects, /convos 等未识别命令 — 提示用户
        if content.startswith("/"):
            logger.debug("Unknown command: %s", content[:30])
            await lark_bridge.send_text(
                chat_id,
                f"❓ 未知命令: {content.split()[0]}\n输入 /help 查看可用指令",
            )
            return

        # 纯文本 → 创建任务
        await self._cmd_create_task(chat_id, content, event, current_user=current_user)

    # ── 指令处理器 ─────────────────────────────────────────

    async def _cmd_create_task(self, chat_id: str, prompt: str, event: LarkEvent, current_user: Optional[dict] = None):
        """创建任务"""
        # 从 DB 加载历史去重集合（首次懒加载）
        await self._ensure_dedup_loaded()

        # 基于 Lark message_id 去重，防止 ws 重连后历史消息重复创建任务
        message_id = event.message_id
        if message_id:
            if message_id in self._seen_message_ids:
                logger.info("[message_handler] Skipping duplicate task creation for message_id=%s", message_id)
                return
            self._seen_message_ids.add(message_id)

        # 基于消息创建时间过滤：忽略服务启动之前的旧消息（Lark 重连重推）
        msg_create_time = event.create_time
        if msg_create_time and msg_create_time < self._boot_time_ms - 10000:  # 10秒容差
            logger.info(
                "[message_handler] Skipping old message (create_time=%d < boot_time=%d), message_id=%s",
                msg_create_time, self._boot_time_ms, message_id or "?"
            )
            return

        # 启动冷却期：boot 后 15 秒内忽略所有 Lark 触发的任务创建
        # 防止 WebSocket 重连时重推的消息绕过其他过滤
        if (int(time.time() * 1000) - self._boot_time_ms) < 15000:
            # 在冷却期内，只允许 source_message_id 去重集合中不存在的消息通过
            # 额外检查：用 prompt 内容做近似去重
            async with async_session_factory() as sess:
                result = await sess.execute(
                    sa_text(
                        "SELECT 1 FROM tasks WHERE prompt = :prompt AND created_at > datetime('now', '-24 hours') LIMIT 1"
                    ),
                    {"prompt": prompt},
                )
                if result.fetchone():
                    logger.info(
                        "[message_handler] Skipping duplicate prompt during cooldown, message_id=%s",
                        message_id or "?",
                    )
                    return

        # 项目级写权限检查
        if TIDE_REQUIRE_AUTH and current_user:
            project_id = await self._resolve_active_project_id(chat_id)
            if project_id:
                from fastapi import HTTPException
                try:
                    await check_project_write_permission(project_id, current_user)
                except HTTPException:
                    await lark_bridge.send_text(chat_id, "⚠️ 您没有该项目的写入权限。")
                    return

        # 从持久化会话获取 agent/model 设置
        conv = await conversation_service.get_or_create(
            workspace_id="default", chat_id=chat_id
        )
        agent_id = conv.get("agent_id") or "codex"
        model = conv.get("model") or ""
        conversation_id = conv.get("id") or ""

        # 合并暂存附件和当前消息附件
        _prune_pending_attachments()
        key = _pending_key(chat_id, event.sender_id)
        pending = _PENDING_ATTACHMENTS.pop(key, None)
        attachment_paths: list[str] = []
        if pending and time.time() - float(pending.get("timestamp", 0) or 0) < _PENDING_ATTACHMENTS_TTL_SECONDS:
            for item in pending.get("attachments", []) or []:
                lp = (item.get("local_path") if isinstance(item, dict) else "") or ""
                if lp:
                    attachment_paths.append(lp)
        # 当前消息本身也可能带附件（文本+附件同发场景）
        for item in event.attachments or []:
            lp = (item.get("local_path") if isinstance(item, dict) else "") or ""
            if lp and lp not in attachment_paths:
                attachment_paths.append(lp)

        try:
            task = await self.task_service.create_task(
                workspace_id="default",
                prompt=prompt,
                agent_id=agent_id,
                model=model,
                cwd=None,  # 使用默认 CWD
                attachments=attachment_paths or None,
                chat_id=chat_id,
                conversation_id=conversation_id,
            )
            task_id = (task.get("id", "") or "")
            # 持久化 source_message_id 到 DB，用于跨重启去重
            if message_id and task_id:
                try:
                    async with async_session_factory() as session:
                        await session.execute(
                            sa_text("UPDATE tasks SET source_message_id = :mid WHERE id = :tid"),
                            {"mid": message_id, "tid": task_id},
                        )
                        await session.commit()
                except Exception:
                    logger.debug("[message_handler] Failed to persist source_message_id", exc_info=True)
            logger.info(
                "Task created from Lark: task_id=%s agent=%s",
                task_id[:8],
                agent_id,
            )
            # 广播到前端 WebSocket
            # 注意：Lark 卡片由事件系统统一发送（task_status_changed → lark_bridge.on_task_status_changed）
            await lark_bridge.on_lark_task_created(task)
        except Exception:
            logger.exception("Failed to create task from Lark message")
            await lark_bridge.send_text(chat_id, "❌ 任务创建失败，请稍后重试")

    async def _cmd_help(self, chat_id: str):
        """显示帮助信息"""
        help_text = (
            "📖 Tide 指令大全\n"
            "\n"
            "📋 展示类\n"
            "• /projects 或 /项目 — 显示项目面板\n"
            "• /chats 或 /普通对话 — 显示普通对话列表\n"
            "• /convos 或 /对话 — 显示当前项目的对话列表\n"
            "• /conv <id> — 查看对话详情\n"
            "• /project <n> — 查看第 n 个项目详情\n"
            "• /latest <n> — 查看第 n 个项目的最新对话\n"
            "\n"
            "📂 导航类\n"
            "• /mark-project <path> — 标记为项目目录\n"
            "• /mark-chat <id> — 标记为普通对话\n"
            "\n"
            "⚡ 操作类\n"
            "• /daily 或 /daily=YYYY-MM-DD — 查看日报\n"
            "• /approve <id> — 批准权限请求\n"
            "• /reject <id> — 拒绝权限请求\n"
            "• /cancel <id> — 取消任务\n"
            "• /stop — 停止当前任务\n"
            "\n"
            "🔀 工作流 / 工作项\n"
            "• /workflow list — 列出工作流\n"
            "• /workflow run <id> — 触发工作流执行\n"
            "• /wi create <标题> — 创建工作项\n"
            "• /wi list — 列出当前项目工作项\n"
            "• /wi move <item_id> <stage> — 推进阶段\n"
            "\n"
            "📝 Plan 类\n"
            "• /plan — 进入计划输入模式\n"
            "• /plan <描述> — 创建执行计划\n"
            "• /plan status — 查看计划状态\n"
            "• /plan stop — 停止当前计划\n"
            "\n"
            "⚙️ 配置类\n"
            "• /agents — 查看可用 Agent 列表\n"
            "• /agent=<名称> — 切换 Agent（codex/claude/qoder）\n"
            "• /model=<模型> — 指定模型\n"
            "• /status — 查看运行状态\n"
            "• /help — 显示帮助\n"
            "\n"
            "💡 直接发送文字将创建并执行任务"
        )
        await lark_bridge.send_text(chat_id, help_text)

    async def _cmd_stop(self, chat_id: str, content: str):
        """停止当前任务"""
        try:
            result = await self.task_service.list_tasks(
                workspace_id="default",
                status="running",
                chat_id=chat_id,
            )
            items = result.get("items", []) if isinstance(result, dict) else []
            if items:
                # 停止最新的运行中任务（按 created_at DESC 排列）
                latest = items[0]
                task_id = latest.get("id") or latest.get("task_id")
                if task_id:
                    await self.task_service.stop_task(task_id)
                    logger.info("Task stopped via Lark /stop: %s", task_id[:8])
                    await lark_bridge.send_text(chat_id, f"✅ 已停止任务 {task_id[:8]}...")
            else:
                logger.info("No running tasks to stop for chat=%s", chat_id[:8] if chat_id else "-")
                await lark_bridge.send_text(chat_id, "ℹ️ 当前没有运行中的任务")
        except Exception:
            logger.exception("Failed to stop task via Lark")
            await lark_bridge.send_text(chat_id, "❌ 停止任务失败")

    async def _cmd_status(self, chat_id: str):
        """查询状态"""
        try:
            result = await self.task_service.list_tasks(
                workspace_id="default",
                status="running",
            )
            items = result.get("items", []) if isinstance(result, dict) else []
            count = len(items)
            logger.info(
                "Status query from chat=%s: %d running tasks",
                chat_id[:8] if chat_id else "-",
                count,
            )
            if count > 0:
                lines = [f"📊 当前有 {count} 个运行中的任务："]
                for t in items[:5]:
                    prompt = (t.get("prompt") or "")[:40]
                    agent = t.get("agent_id") or "unknown"
                    lines.append(f"  • [{agent}] {prompt}")
                reply = "\n".join(lines)
            else:
                reply = "📊 当前没有运行中的任务"
            await lark_bridge.send_text(chat_id, reply)
        except Exception:
            logger.exception("Failed to get status")
            await lark_bridge.send_text(chat_id, "❌ 查询状态失败")

    async def _cmd_plan(self, chat_id: str, content: str, current_user: Optional[dict] = None):
        """Plan 命令集"""
        from backend.services.chat_state import get_chat_state, save_chat_state

        # 解析子命令
        plan_content = content[5:].strip() if len(content) > 5 else ""
        sub = plan_content.lower().strip()

        # /plan (无参数) — 进入 Plan 输入模式
        if not plan_content:
            state = await get_chat_state(chat_id)
            state.plan_input_mode = True
            await save_chat_state(state)
            await lark_bridge.send_text(
                chat_id,
                "📝 已进入 Plan 模式。请发送任务清单，例如：\n"
                "- 检查 README\n"
                "- 修复审批流程\n"
                "- 运行测试\n\n"
                "或发送 `/plan status` 查看当前 Plan 状态。",
            )
            return

        # /plan status | /plan 状态
        if sub in ("status", "refresh", "状态", "刷新"):
            await self._plan_status(chat_id, current_user=current_user)
            return

        # /plan stop | /plan 停止
        if sub in ("stop", "停止"):
            await self._plan_stop(chat_id, current_user=current_user)
            return

        # /plan <tasks> — 创建新 Plan
        await self._plan_create(chat_id, plan_content, current_user=current_user)

    @staticmethod
    def _parse_plan_definition(plan: dict) -> dict:
        import json as _json

        raw = plan.get("definition") if isinstance(plan, dict) else None
        if not raw:
            return {}
        if isinstance(raw, dict):
            return raw
        try:
            return _json.loads(raw)
        except (TypeError, ValueError):
            return {}

    async def _plan_status(self, chat_id: str, current_user: Optional[dict] = None):
        """查询最新 Plan 状态"""
        try:
            from backend.services.plan_service import plan_service

            plans = await plan_service.list_plans(workspace_id="default", limit=10)
            items = plans if isinstance(plans, list) else (
                plans.get("items", []) if isinstance(plans, dict) else []
            )

            # 项目级权限过滤：非 admin 用户只能看到可访问项目的 Plan
            if items and current_user:
                accessible_ids = await get_accessible_project_ids(current_user)
                if accessible_ids is not None:
                    filtered = []
                    for p in items:
                        pid = encode_project_id(p.get("cwd", "") or "")
                        if not pid or pid in accessible_ids:
                            filtered.append(p)
                    items = filtered

            if not items:
                await lark_bridge.send_text(chat_id, "📋 当前没有 Plan")
                return
            plan = items[0]
            plan_id_full = plan.get("id", "") or ""
            plan_id = plan_id_full[:8]
            status = plan.get("status", "unknown")
            definition = self._parse_plan_definition(plan)
            title = definition.get("title") or "无标题"

            tasks = await plan_service.get_plan_tasks(plan_id_full) if plan_id_full else []
            total = len(tasks)
            done = sum(1 for t in tasks if t.get("status") == "completed")
            running = sum(1 for t in tasks if t.get("status") == "running")
            failed = sum(1 for t in tasks if t.get("status") == "failed")

            lines = [
                f"📋 **{title}** (`{plan_id}...`)",
                f"状态：{status} | 进度：{done}/{total}",
                f"运行中：{running} | 失败：{failed}",
            ]
            if tasks:
                lines.append("\n任务列表：")
                emoji_map = {
                    "completed": "✅",
                    "running": "🔄",
                    "failed": "❌",
                    "pending": "⏳",
                    "queued": "⏳",
                }
                for i, t in enumerate(tasks[:10], 1):
                    t_status = t.get("status", "pending")
                    t_title = (t.get("title") or "")[:40]
                    emoji = emoji_map.get(t_status, "•")
                    lines.append(f"  {emoji} {i}. {t_title}")

            await lark_bridge.send_text(chat_id, "\n".join(lines))
        except Exception:
            logger.exception("Failed to get plan status")
            await lark_bridge.send_text(chat_id, "❌ 查询 Plan 状态失败")

    async def _plan_stop(self, chat_id: str, current_user: Optional[dict] = None):
        """停止当前 Plan"""
        try:
            from backend.services.plan_service import plan_service

            plans = await plan_service.list_plans(workspace_id="default", limit=1)
            items = plans if isinstance(plans, list) else (
                plans.get("items", []) if isinstance(plans, dict) else []
            )
            if not items:
                await lark_bridge.send_text(chat_id, "当前没有可停止的 Plan")
                return
            plan = items[0]
            plan_id = plan.get("id", "") or ""

            # 权限检查：确认用户对该 plan 所属项目有写权限
            if current_user:
                plan_cwd = plan.get("cwd") or ""
                if plan_cwd:
                    from fastapi import HTTPException
                    try:
                        await check_cwd_write_permission(plan_cwd, current_user)
                    except HTTPException:
                        await lark_bridge.send_text(chat_id, "⚠️ 您没有该 Plan 所属项目的操作权限。")
                        return

            if plan.get("status") not in ("active",):
                await lark_bridge.send_text(chat_id, f"Plan `{plan_id[:8]}` 已经结束")
                return
            await plan_service.stop_plan(plan_id)
            await lark_bridge.send_text(chat_id, f"✅ 已停止 Plan `{plan_id[:8]}`")
        except Exception:
            logger.exception("Failed to stop plan")
            await lark_bridge.send_text(chat_id, "❌ 停止 Plan 失败")

    async def _plan_create(self, chat_id: str, plan_content: str, current_user: Optional[dict] = None):
        """从文本创建新 Plan"""
        from backend.services.chat_state import get_chat_state, save_chat_state

        # viewer 角色检查
        if current_user and current_user.get("role") == "viewer":
            await lark_bridge.send_text(chat_id, "⚠️ Viewer 角色无权创建 Plan。")
            return

        state = await get_chat_state(chat_id)
        state.plan_input_mode = False
        await save_chat_state(state)

        # 项目写权限检查
        if current_user and state.cwd:
            from fastapi import HTTPException
            try:
                await check_cwd_write_permission(state.cwd, current_user)
            except HTTPException:
                await lark_bridge.send_text(chat_id, "⚠️ 您没有当前项目的写入权限，无法创建 Plan。")
                return

        # 解析任务列表（支持 - 或数字列表）
        lines = plan_content.strip().splitlines()
        tasks: list = []
        for line in lines:
            line = line.strip()
            cleaned = re.sub(r"^[-*•]\s*|^\d+[.)]\s*", "", line).strip()
            if cleaned:
                tasks.append(cleaned)

        if not tasks:
            await lark_bridge.send_text(
                chat_id,
                "未识别到任务。请每行一个任务，例如：\n- 检查代码\n- 运行测试",
            )
            return

        try:
            from backend.services.plan_service import plan_service

            title = tasks[0][:50] if len(tasks) == 1 else f"Plan ({len(tasks)} 任务)"
            definition = {
                "title": title,
                "tasks": [{"title": t, "prompt": t} for t in tasks],
            }
            plan = await plan_service.create_plan(
                workspace_id="default",
                definition_json=definition,
                cwd=state.cwd or None,
                model=state.model or None,
            )
            plan_id = (plan.get("id", "") or "")[:8] if isinstance(plan, dict) else ""
            preview = "\n".join(f"  • {t}" for t in tasks[:8])
            suffix = "\n  ..." if len(tasks) > 8 else ""
            await lark_bridge.send_text(
                chat_id,
                f"✅ Plan 已创建 (`{plan_id}...`)，共 {len(tasks)} 个任务\n{preview}{suffix}",
            )
        except Exception:
            logger.exception("Failed to create plan")
            await lark_bridge.send_text(chat_id, "❌ 创建 Plan 失败")

    # ── Workflow / WorkItem 指令 ─────────────────────────

    async def _cmd_workflow(self, chat_id: str, content: str, current_user: Optional[dict] = None):
        """/workflow run <id> | /workflow list — 工作流触发入口。"""
        body = content[len("/workflow"):].strip()
        parts = body.split(None, 2) if body else []
        sub = (parts[0].lower() if parts else "")

        if sub == "list" or not sub:
            try:
                from backend.services.workflow_service import workflow_service

                workflows = await workflow_service.list_workflows(
                    workspace_id="default", limit=20
                )
                if not workflows:
                    await lark_bridge.send_text(chat_id, "📝 当前没有可用的工作流")
                    return
                lines = [f"📝 工作流列表（共 {len(workflows)} 个）\n"]
                for w in workflows[:20]:
                    wid = (w.get("id") or "")[:8]
                    name = w.get("name") or "未命名工作流"
                    desc = (w.get("description") or "").strip()
                    suffix = f" — {desc[:40]}" if desc else ""
                    lines.append(f"  • `{wid}...`  {name}{suffix}")
                lines.append("\n使用 `/workflow run <id>` 触发执行")
                await lark_bridge.send_text(chat_id, "\n".join(lines))
            except Exception:
                logger.exception("Failed to list workflows from Lark")
                await lark_bridge.send_text(chat_id, "❌ 查询工作流列表失败")
            return

        if sub == "run":
            workflow_id = (parts[1] if len(parts) > 1 else "").strip()
            if not workflow_id:
                await lark_bridge.send_text(
                    chat_id, "用法：/workflow run <workflow_id>"
                )
                return
            # 权限检查：与 Web 端 _check_workflow_write_permission 一致
            if TIDE_REQUIRE_AUTH and current_user:
                role = current_user.get("role", "member")
                if role == "viewer":
                    await lark_bridge.send_text(chat_id, "⚠️ Viewer 角色无权运行工作流。")
                    return
                if role != "admin":
                    # member 角色：仅允许运行自己创建的 workflow 或 created_by 为空的公共 workflow
                    try:
                        from sqlalchemy import text as _text
                        async with async_session_factory() as _sess:
                            _r = await _sess.execute(
                                _text("SELECT created_by FROM workflows WHERE id = :wid OR id LIKE :prefix LIMIT 1"),
                                {"wid": workflow_id, "prefix": f"{workflow_id}%"},
                            )
                            _row = _r.fetchone()
                        if _row:
                            created_by = _row[0]
                            if created_by is not None and created_by != current_user.get("id"):
                                await lark_bridge.send_text(chat_id, "⚠️ 您只能运行自己创建的工作流。")
                                return
                        else:
                            await lark_bridge.send_text(chat_id, f"❌ 找不到工作流：`{workflow_id}`")
                            return
                    except Exception:
                        pass  # 查询失败时不阻止操作
            try:
                from backend.services.workflow_service import workflow_service
                from backend.services.workflow_engine import workflow_engine

                # 支持前缀短 ID：列表中查找匹配项
                resolved_id = workflow_id
                if len(workflow_id) < 32:
                    workflows = await workflow_service.list_workflows(
                        workspace_id="default", limit=200
                    )
                    matched = next(
                        (w for w in workflows if (w.get("id") or "").startswith(workflow_id)),
                        None,
                    )
                    if not matched:
                        await lark_bridge.send_text(
                            chat_id, f"❌ 找不到工作流：`{workflow_id}`"
                        )
                        return
                    resolved_id = matched["id"]

                run_id = await workflow_engine.start_run(
                    workflow_id=resolved_id,
                    input_context={"chat_id": chat_id},
                    trigger_type="lark_message",
                )
                logger.info(
                    "Workflow triggered via Lark: workflow=%s run=%s chat=%s",
                    resolved_id[:8], run_id[:8],
                    chat_id[:8] if chat_id else "-",
                )
                await lark_bridge.send_text(
                    chat_id,
                    f"✅ 已启动工作流 `{resolved_id[:8]}`\nrun_id：`{run_id[:8]}...`",
                )
            except ValueError as exc:
                await lark_bridge.send_text(chat_id, f"❌ {exc}")
            except Exception:
                logger.exception("Failed to start workflow run from Lark")
                await lark_bridge.send_text(chat_id, "❌ 启动工作流失败")
            return

        await lark_bridge.send_text(
            chat_id,
            "用法：\n• /workflow list\n• /workflow run <workflow_id>",
        )

    async def _resolve_active_project_id(self, chat_id: str) -> Optional[str]:
        """从 chat_state 推导当前项目的 project_id（base64(cwd)）。"""
        import base64
        from pathlib import Path
        from backend.services.chat_state import get_chat_state
        from backend.services.project_discovery import find_project_root

        state = await get_chat_state(chat_id)
        cwd = (state.active_project_key or state.cwd or "").strip()
        if not cwd:
            return None
        try:
            root = find_project_root(Path(cwd))
            cwd = str(root) if root else cwd
        except Exception:
            pass
        return base64.urlsafe_b64encode(cwd.encode()).decode().rstrip("=")

    async def _cmd_work_item(self, chat_id: str, content: str, current_user: Optional[dict] = None):
        """/wi create|list|move — 工作项管理入口。"""
        body = content[len("/wi"):].strip()
        parts = body.split(None, 2) if body else []
        sub = (parts[0].lower() if parts else "")

        if not sub:
            await lark_bridge.send_text(
                chat_id,
                "用法：\n"
                "• /wi create <标题>\n"
                "• /wi list\n"
                "• /wi move <item_id> <stage_label>",
            )
            return

        if sub == "create":
            title = (parts[1] + (" " + parts[2] if len(parts) > 2 else "")) if len(parts) > 1 else ""
            title = title.strip()
            if not title:
                await lark_bridge.send_text(chat_id, "用法：/wi create <标题>")
                return
            # viewer 角色检查
            if current_user and current_user.get("role") == "viewer":
                await lark_bridge.send_text(chat_id, "⚠️ Viewer 角色无权创建工作项。")
                return
            project_id = await self._resolve_active_project_id(chat_id)
            if not project_id:
                await lark_bridge.send_text(
                    chat_id, "❌ 请先使用 /mark-project 标记项目目录"
                )
                return
            # 项目级写权限检查
            if TIDE_REQUIRE_AUTH and current_user and project_id:
                from fastapi import HTTPException
                try:
                    await check_project_write_permission(project_id, current_user)
                except HTTPException:
                    await lark_bridge.send_text(chat_id, "⚠️ 您没有该项目的写入权限。")
                    return
            try:
                from backend.services.work_item_service import work_item_service
                from backend.models.schemas import WorkItemCreate

                item = await work_item_service.create_work_item(
                    WorkItemCreate(
                        project_id=project_id,
                        title=title,
                        source_type="lark",
                        source_id=chat_id,
                    )
                )
                item_id = (item.get("id") or "")[:8]
                node_id = (item.get("current_node_id") or "")[:8]
                await lark_bridge.send_text(
                    chat_id,
                    f"✅ 已创建工作项 `{item_id}...`\n标题：{title}\n当前节点：`{node_id}`",
                )
            except ValueError as exc:
                await lark_bridge.send_text(chat_id, f"❌ {exc}")
            except Exception:
                logger.exception("Failed to create work item from Lark")
                await lark_bridge.send_text(chat_id, "❌ 创建工作项失败")
            return

        if sub == "list":
            project_id = await self._resolve_active_project_id(chat_id)
            if not project_id:
                await lark_bridge.send_text(
                    chat_id, "❌ 请先使用 /mark-project 标记项目目录"
                )
                return
            # 项目级权限过滤：检查用户是否有权访问该项目
            if current_user:
                accessible_ids = await get_accessible_project_ids(current_user)
                if accessible_ids is not None and project_id not in accessible_ids:
                    await lark_bridge.send_text(chat_id, "⚠️ 您没有该项目的访问权限。")
                    return
            try:
                from backend.services.work_item_service import work_item_service

                items = await work_item_service.list_work_items(
                    project_id=project_id, status="active"
                )
                if not items:
                    await lark_bridge.send_text(chat_id, "📋 当前项目没有进行中的工作项")
                    return
                lines = [f"📋 当前项目工作项（共 {len(items)} 个）\n"]
                for it in items[:20]:
                    iid = (it.get("id") or "")[:8]
                    title = (it.get("title") or "无标题")[:40]
                    node = (it.get("current_node_id") or "-")[:12]
                    lines.append(f"  • `{iid}...` [{node}] {title}")
                await lark_bridge.send_text(chat_id, "\n".join(lines))
            except Exception:
                logger.exception("Failed to list work items from Lark")
                await lark_bridge.send_text(chat_id, "❌ 查询工作项失败")
            return

        if sub == "move":
            if len(parts) < 3:
                await lark_bridge.send_text(
                    chat_id, "用法：/wi move <item_id> <stage_label>"
                )
                return
            item_arg = parts[1].strip()
            stage_label = parts[2].strip()
            try:
                from backend.services.work_item_service import work_item_service

                # 支持短 ID：在全列表中匹配前缀
                items = await work_item_service.list_work_items()
                target_item = next(
                    (it for it in items if (it.get("id") or "").startswith(item_arg)),
                    None,
                )
                if not target_item:
                    await lark_bridge.send_text(
                        chat_id, f"❌ 找不到工作项：`{item_arg}`"
                    )
                    return

                # 项目级权限检查：用 get_accessible_project_ids 过滤
                if TIDE_REQUIRE_AUTH and current_user:
                    item_project_id = target_item.get("project_id")
                    if item_project_id:
                        accessible_ids = await get_accessible_project_ids(current_user)
                        if accessible_ids is not None and item_project_id not in accessible_ids:
                            await lark_bridge.send_text(chat_id, "⚠️ 您没有该工作项所属项目的访问权限。")
                            return
                        from fastapi import HTTPException as _HTTPExc
                        try:
                            await check_project_write_permission(item_project_id, current_user)
                        except _HTTPExc:
                            await lark_bridge.send_text(chat_id, "⚠️ 您没有该项目的写入权限。")
                            return

                # 通过 stage_label 查找目标节点（支持 node_id 或可见节点的 label）
                workflow_id = target_item.get("workflow_id")
                definition = await work_item_service._load_workflow_definition(workflow_id) if workflow_id else None
                target_node_id = stage_label
                if definition:
                    nodes = definition.get("nodes", [])
                    matched = None
                    for n in nodes:
                        if n.get("id") == stage_label:
                            matched = n
                            break
                        label = (n.get("data", {}) or {}).get("label") or \
                                (n.get("data", {}) or {}).get("name") or ""
                        if label == stage_label:
                            matched = n
                            break
                    if matched:
                        target_node_id = matched["id"]

                await work_item_service.transition_work_item(
                    item_id=target_item["id"],
                    target_node_id=target_node_id,
                    operator=f"lark:{chat_id[:8]}" if chat_id else "lark",
                    trigger_type="manual",
                )
                await lark_bridge.send_text(
                    chat_id,
                    f"✅ 已推进工作项 `{target_item['id'][:8]}` → `{target_node_id[:12]}`",
                )
            except ValueError as exc:
                await lark_bridge.send_text(chat_id, f"❌ {exc}")
            except Exception:
                logger.exception("Failed to transition work item from Lark")
                await lark_bridge.send_text(chat_id, "❌ 推进工作项失败")
            return

        await lark_bridge.send_text(
            chat_id,
            f"❓ 未知子命令：/wi {sub}\n可用：create / list / move",
        )

    async def _cmd_agents(self, chat_id: str):
        """查看可用 Agent 列表"""
        import shutil
        from backend.runtime.adapters import AGENT_ADAPTERS
        from backend.services.chat_state import get_chat_state

        state = await get_chat_state(chat_id)
        current_agent = state.agent_id or "codex"

        lines = ["🤖 **可用 Agent 列表**\n"]

        # 本地 Agent
        lines.append("**本地 Agent：**")
        for agent_id, adapter in AGENT_ADAPTERS.items():
            available = bool(adapter.bin_name and shutil.which(adapter.bin_name))
            status_icon = "✅" if available else "❌"
            active_mark = " 👈 当前" if agent_id == current_agent else ""
            lines.append(f"  • {status_icon} {agent_id} ({adapter.label}){active_mark}")

        # 远程 A2A Agent
        try:
            async with async_session_factory() as session:
                result = await session.execute(sa_text(
                    "SELECT id, name, description FROM remote_agents WHERE status = 'active'"
                ))
                remote_rows = result.fetchall()
            if remote_rows:
                lines.append("\n**远程 A2A Agent：**")
                for row in remote_rows:
                    agent_id_r, name, description = row
                    desc_text = f" — {description}" if description else ""
                    active_mark = " 👈 当前" if f"a2a:{agent_id_r}" == current_agent else ""
                    lines.append(f"  • 🌐 {name}{desc_text}{active_mark}")
        except Exception:
            logger.debug("Failed to list remote agents", exc_info=True)

        lines.append(f"\n💡 使用 `/agent=<名称>` 切换 Agent")
        await lark_bridge.send_text(chat_id, "\n".join(lines))

    async def _cmd_set_agent(self, chat_id: str, agent_id: str):
        """切换 Agent"""
        from backend.runtime.adapters import AGENT_ADAPTERS

        normalized = agent_id.lower().strip()
        if normalized in AGENT_ADAPTERS:
            conv = await conversation_service.get_or_create(
                workspace_id="default", chat_id=chat_id
            )
            await conversation_service.set_agent(conv["id"], normalized)
            logger.info(
                "Agent switched to '%s' for chat=%s",
                normalized,
                chat_id[:8] if chat_id else "-",
            )
            await lark_bridge.send_text(chat_id, f"✅ 已切换到 Agent: {normalized}")
        else:
            logger.warning("Unknown agent: %s", agent_id)
            await lark_bridge.send_text(
                chat_id,
                f"❌ 未知 Agent: {agent_id}，可选: codex/claude/qoder",
            )

    async def _cmd_set_model(self, chat_id: str, model: str):
        """指定模型"""
        conv = await conversation_service.get_or_create(
            workspace_id="default", chat_id=chat_id
        )
        await conversation_service.set_model(conv["id"], model)
        logger.info(
            "Model set to '%s' for chat=%s",
            model,
            chat_id[:8] if chat_id else "-",
        )
        await lark_bridge.send_text(chat_id, f"✅ 已设置模型: {model}")

    async def _cmd_mark_project(self, chat_id: str, path_text: str):
        """标记为项目目录"""
        from pathlib import Path
        from backend.services.chat_state import get_chat_state, save_chat_state

        state = await get_chat_state(chat_id)
        path = Path(path_text).expanduser() if path_text else Path(state.cwd)
        if not path.is_absolute():
            path = Path(state.cwd) / path
        try:
            path = path.resolve()
        except OSError:
            pass

        if not path.exists() or not path.is_dir():
            await lark_bridge.send_text(chat_id, f"不是有效目录：{path}")
            return

        state.active_project_key = str(path)
        state.cwd = str(path)
        await save_chat_state(state)
        await lark_bridge.send_text(chat_id, f"✅ 已标记为项目：`{path}`")

    async def _cmd_mark_chat(self, chat_id: str, session_id: str):
        """标记为普通对话"""
        from backend.services.chat_state import get_chat_state

        state = await get_chat_state(chat_id)
        session_id = session_id.strip() or state.active_session_id
        if not session_id:
            await lark_bridge.send_text(
                chat_id,
                "用法：/mark-chat <session_id>，或先打开一个对话后发送 /mark-chat"
            )
            return
        # 标记为普通对话（信息回复即可，分类存储在下个迭代完善）
        await lark_bridge.send_text(chat_id, f"✅ 已标记为普通对话：`{session_id}`")

    async def _cmd_daily(self, chat_id: str, content: str, current_user: Optional[dict] = None):
        """每日进度报告"""
        import subprocess
        from datetime import date, datetime
        from backend.services.chat_state import get_chat_state
        from backend.services.session_discovery import discover_sessions

        # 解析日期参数
        report_date = date.today()
        if "=" in content:
            date_str = content.split("=", 1)[1].strip()
            try:
                report_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                await lark_bridge.send_text(chat_id, "日期格式不正确。用法：`/daily=2026-06-01`")
                return

        state = await get_chat_state(chat_id)
        today_str = report_date.isoformat()

        # 判断是否为 admin
        is_admin = current_user and current_user.get("role") == "admin"
        user_id = current_user.get("id") if current_user else None
        username = current_user.get("username", "") if current_user else ""

        # 获取当日会话
        try:
            sessions = discover_sessions(project_cwd=state.active_project_key or state.cwd)
        except Exception:
            logger.exception("discover_sessions failed")
            sessions = []
        today_sessions = [
            s for s in sessions
            if s.get("last_active", "").startswith(today_str)
            or s.get("created_at", "").startswith(today_str)
        ]

        # 获取当日任务（从数据库按用户过滤）
        task_total = 0
        task_completed = 0
        task_running = 0
        try:
            async with async_session_factory() as session:
                if is_admin:
                    # admin 看全部
                    result = await session.execute(sa_text(
                        "SELECT status, COUNT(*) FROM tasks "
                        "WHERE created_at >= :start AND created_at < :end "
                        "GROUP BY status"
                    ), {"start": today_str, "end": f"{today_str}T23:59:59"})
                else:
                    # 普通用户：只看自己创建的或分配给自己的
                    result = await session.execute(sa_text(
                        "SELECT status, COUNT(*) FROM tasks "
                        "WHERE created_at >= :start AND created_at < :end "
                        "AND (creator_id = :uid OR assigned_to = :uid OR creator_id = :uname OR assigned_to = :uname) "
                        "GROUP BY status"
                    ), {"start": today_str, "end": f"{today_str}T23:59:59", "uid": user_id or "", "uname": username})
                for row in result.fetchall():
                    status, count = row
                    task_total += count
                    if status == "completed":
                        task_completed += count
                    elif status == "running":
                        task_running += count
        except Exception:
            logger.debug("Failed to query daily tasks", exc_info=True)

        # Git 摘要
        git_summary = ""
        try:
            git_args = ["git", "log", f"--since={today_str}", "--oneline", "--no-merges", "-20"]
            # 非 admin 按用户过滤 git 日志
            if not is_admin and username:
                git_args.extend([f"--author={username}"])
            result = subprocess.run(
                git_args,
                capture_output=True, text=True, timeout=5,
                cwd=state.cwd,
            )
            if result.returncode == 0 and result.stdout.strip():
                git_summary = result.stdout.strip()
        except Exception:
            pass

        # 构建报告
        user_label = f"（{username}）" if username and not is_admin else "（全局）" if is_admin else ""
        lines = [f"📊 **{report_date} 进度报告**{user_label}\n"]
        lines.append(f"项目目录：`{state.cwd}`")
        lines.append(f"当日任务：{task_total} 总计 / {task_completed} 完成 / {task_running} 运行中")
        lines.append(f"当日会话数：{len(today_sessions)}")

        if today_sessions:
            lines.append("\n**当日会话：**")
            for s in today_sessions[:8]:
                agent = s.get("agent_id", "?")
                title = s.get("title", "")[:40]
                lines.append(f"  • [{agent}] {title}")

        if git_summary:
            lines.append(f"\n**Git 提交：**\n```\n{git_summary}\n```")
        else:
            lines.append("\n（当日无 Git 提交）")

        await lark_bridge.send_text(chat_id, "\n".join(lines))

    async def _cmd_approve(self, chat_id: str, approval_id: str, approved: bool = True):
        """批准/拒绝审批"""
        if not approval_id:
            await lark_bridge.send_text(chat_id, "用法：/approve <审批ID>")
            return

        try:
            from backend.db.engine import async_session_factory
            from sqlalchemy import text

            async with async_session_factory() as session:
                # 查找审批记录
                result = await session.execute(
                    text("SELECT id, task_id, command, status FROM agent_permission WHERE id = :id OR id LIKE :prefix"),
                    {"id": approval_id, "prefix": f"{approval_id}%"},
                )
                row = result.fetchone()
                if not row:
                    await lark_bridge.send_text(chat_id, f"找不到审批记录：`{approval_id}`")
                    return

                perm_id, task_id, command, status = row
                if status != "pending":
                    await lark_bridge.send_text(chat_id, f"审批 `{perm_id[:8]}` 已经处理（状态：{status}）")
                    return

                new_status = "approved" if approved else "rejected"
                await session.execute(
                    text("UPDATE agent_permission SET status = :status WHERE id = :id"),
                    {"status": new_status, "id": perm_id},
                )
                await session.commit()

                action = "批准" if approved else "拒绝"
                cmd_preview = (command or "")[:60]
                await lark_bridge.send_text(
                    chat_id,
                    f"{'✅' if approved else '❌'} 已{action}审批 `{perm_id[:8]}`\n命令：`{cmd_preview}`"
                )
        except Exception:
            logger.exception("Failed to process approval")
            await lark_bridge.send_text(chat_id, "❌ 处理审批失败")

    async def _cmd_reject(self, chat_id: str, approval_id: str):
        """拒绝审批"""
        await self._cmd_approve(chat_id, approval_id, approved=False)

    async def _cmd_cancel(self, chat_id: str, task_id: str):
        """取消排队任务"""
        if not task_id:
            await lark_bridge.send_text(chat_id, "用法：/cancel <任务ID>")
            return

        try:
            from backend.db.engine import async_session_factory
            from sqlalchemy import text

            async with async_session_factory() as session:
                result = await session.execute(
                    text("SELECT id, status, prompt FROM tasks WHERE id = :id OR id LIKE :prefix"),
                    {"id": task_id, "prefix": f"{task_id}%"},
                )
                row = result.fetchone()
                if not row:
                    await lark_bridge.send_text(chat_id, f"找不到任务：`{task_id}`")
                    return

                tid, status, prompt = row
                if status not in ("pending", "queued", "waiting"):
                    await lark_bridge.send_text(chat_id, f"任务 `{tid[:8]}` 不可取消（当前状态：{status}）")
                    return

                await session.execute(
                    text("UPDATE tasks SET status = 'cancelled' WHERE id = :id"),
                    {"id": tid},
                )
                await session.commit()

                prompt_preview = (prompt or "")[:40]
                await lark_bridge.send_text(chat_id, f"✅ 已取消任务 `{tid[:8]}`：{prompt_preview}")
        except Exception:
            logger.exception("Failed to cancel task")
            await lark_bridge.send_text(chat_id, "❌ 取消任务失败")

    # ── 展示类指令 ────────────────────────────────────────

    @staticmethod
    def _filter_archived(
        projects: list, sessions: list
    ) -> tuple:
        """Task #89: 过滤已归档的项目和会话。

        项目归档 ID 采用 URL-safe base64(cwd)，与 backend/api/projects.py 一致。
        会话归档 ID 直接使用 session_id。
        """
        import base64
        from backend.services.archive_service import archive_store

        archived_project_ids = set(archive_store.list_archived_projects())
        archived_session_ids = set(archive_store.list_archived_sessions())

        filtered_projects = projects
        if archived_project_ids and projects:
            filtered_projects = []
            for p in projects:
                cwd = p.get("cwd") or p.get("id") or ""
                if cwd:
                    encoded = base64.urlsafe_b64encode(cwd.encode()).decode().rstrip("=")
                    if encoded in archived_project_ids:
                        continue
                filtered_projects.append(p)

        filtered_sessions = sessions
        if archived_session_ids and sessions:
            filtered_sessions = [
                s for s in sessions
                if (s.get("session_id") or s.get("id") or "") not in archived_session_ids
            ]

        return filtered_projects, filtered_sessions

    @staticmethod
    def _derive_project_key(state, sessions: list, projects: list) -> str:
        """Task #88: 基于当前 session cwd 推导当前项目 key。

        优先级：
        1. 当前活跃 session 的 project_root / cwd → find_project_root
        2. state.cwd → find_project_root
        3. 回退到 state.active_project_key
        """
        from pathlib import Path
        from backend.services.project_discovery import find_project_root

        # 1. 尝试从当前活跃 session 的 cwd 推导
        if state.active_session_id and sessions:
            for s in sessions:
                sid = s.get("session_id") or s.get("id") or ""
                if sid == state.active_session_id:
                    session_cwd = s.get("project_root") or s.get("cwd") or ""
                    if session_cwd:
                        root = find_project_root(Path(session_cwd))
                        if root:
                            return str(root)
                        # cwd 本身可能就是项目根
                        if any(
                            p.get("cwd") == session_cwd or p.get("id") == session_cwd
                            for p in projects
                        ):
                            return session_cwd
                    break

        # 2. 尝试从 state.cwd 推导
        if state.cwd:
            root = find_project_root(Path(state.cwd))
            if root:
                return str(root)
            # state.cwd 本身可能就是已知项目
            if any(
                p.get("cwd") == state.cwd or p.get("id") == state.cwd
                for p in projects
            ):
                return state.cwd

        # 3. 回退
        return state.active_project_key

    async def _cmd_projects(self, chat_id: str, expanded: bool = False, current_user: Optional[dict] = None):
        """项目面板 — 合并文件扫描 + DB统计 + 注册项目（与 Web API 一致）"""
        from backend.services.card_builder import build_dashboard_card
        from backend.services.chat_state import get_chat_state
        from backend.services.project_discovery import discover_projects, is_worktree_path, _is_excluded_path
        from backend.services.session_discovery import discover_sessions
        from backend.services.archive_service import archive_store
        from backend.api.projects import _aggregate_db_stats, _registry_index, _project_payload, _encode_id

        state = await get_chat_state(chat_id)

        # 1. 合并三个数据源（与 list_projects API 一致）
        discovered_list = discover_projects()
        discovered_map = {item["cwd"]: item for item in discovered_list}
        db_map = await _aggregate_db_stats("default")
        registry = _registry_index()

        cwds: set = set()
        cwds.update(discovered_map.keys())
        cwds.update(db_map.keys())
        cwds.update(registry.keys())

        # 排除 worktree 临时路径和客户端排除路径
        cwds = {
            c for c in cwds
            if not is_worktree_path(c)
            and not _is_excluded_path(c)
        }

        # 2. 归档过滤
        archived_ids = set(archive_store.list_archived_projects())

        # 3. 权限过滤：非 admin 用户只能看到其可访问的项目
        accessible_pids: Optional[set] = None
        if current_user and current_user.get("role") != "admin":
            from backend.services.auth_service import auth_service
            accessible = await auth_service.get_user_accessible_projects(current_user["id"])
            if "*" not in accessible:
                accessible_pids = set(accessible)

        # 4. 构建项目列表
        sessions_by_cwd: dict = {}
        for cwd in cwds:
            sessions_by_cwd[cwd] = discover_sessions(project_cwd=cwd)

        projects: list = []
        for cwd in cwds:
            pid = _encode_id(cwd)
            is_archived = pid in archived_ids
            if is_archived:
                continue
            if accessible_pids is not None and pid not in accessible_pids:
                continue
            projects.append(
                _project_payload(
                    cwd=cwd,
                    discovered=discovered_map.get(cwd),
                    db_stat=db_map.get(cwd),
                    registered=registry.get(cwd),
                    sessions=sessions_by_cwd.get(cwd, []),
                    chat_count=None,
                    archived=is_archived,
                )
            )
        projects.sort(key=lambda p: (p.get("last_active") or ""), reverse=True)

        # 5. 获取全部会话用于 dashboard 卡片（普通对话展示）
        sessions = discover_sessions()
        _, sessions = self._filter_archived([], sessions)

        # 6. 基于当前 session cwd 推导当前项目
        effective_project_key = self._derive_project_key(
            state, sessions, projects
        )

        card = build_dashboard_card(
            chat_id=chat_id,
            projects=projects,
            sessions=sessions,
            active_project_key=effective_project_key,
            active_session_id=state.active_session_id,
            cwd=state.cwd,
            expanded=expanded,
        )
        await lark_bridge.send_card(chat_id, card)

    async def _cmd_chats(self, chat_id: str, expanded: bool = True, current_user: Optional[dict] = None):
        """普通对话列表 — DB优先 + 文件扫描补充，含权限过滤（与 Web API 一致）"""
        from backend.services.card_builder import build_chats_card
        from backend.services.chat_state import get_chat_state
        from backend.services.session_discovery import discover_sessions, discover_chats
        from backend.core.dependencies import get_accessible_project_ids, encode_project_id

        state = await get_chat_state(chat_id)

        # 权限信息
        accessible_pids = await get_accessible_project_ids(current_user)

        # DB 查询：获取无 cwd 的 chat 类型会话 + 带 cwd 的会话（需权限过滤）
        db_sessions: list[dict] = []
        async with async_session_factory() as session:
            r = await session.execute(
                sa_text(
                    """
                    SELECT session_id,
                           MAX(agent_id) as agent_id,
                           MAX(cwd) as cwd,
                           COUNT(*) as task_count,
                           MAX(status) as last_status,
                           MAX(created_at) as last_active
                    FROM tasks
                    WHERE workspace_id = 'default'
                      AND session_id IS NOT NULL
                      AND session_id != ''
                      AND id NOT IN (SELECT task_id FROM plan_tasks)
                    GROUP BY session_id
                    ORDER BY last_active DESC
                    """
                ),
            )
            for row in r.fetchall():
                db_sessions.append({
                    "session_id": row[0],
                    "agent_id": row[1],
                    "cwd": row[2],
                    "task_count": row[3],
                    "last_status": row[4],
                    "last_active": row[5],
                    "source": "db",
                })

        # 文件扫描补充（普通对话）
        file_chats = discover_chats()
        file_meta_map: dict[str, dict] = {}
        for s in file_chats:
            sid = s.get("session_id") or s.get("id")
            if sid:
                file_meta_map[sid] = s

        # 合并：DB 优先，文件补充
        db_sids = {s["session_id"] for s in db_sessions}
        for db_s in db_sessions:
            sid = db_s.get("session_id") or ""
            file_s = file_meta_map.get(sid)
            if file_s:
                if not db_s.get("title"):
                    db_s["title"] = file_s.get("title")
                if not db_s.get("project_root"):
                    db_s["project_root"] = file_s.get("project_root")

        # 仅文件中存在的会话
        for sid, s in file_meta_map.items():
            if sid in db_sids:
                continue
            db_sessions.append({
                "session_id": sid,
                "agent_id": s.get("agent_id"),
                "cwd": s.get("cwd"),
                "project_root": s.get("project_root"),
                "title": s.get("title"),
                "task_count": 1,
                "last_status": s.get("status") or "completed",
                "last_active": s.get("last_active"),
                "source": "file",
            })

        # 权限过滤：无 cwd 的会话(chat)对所有认证用户可见；有 cwd 的按项目权限过滤
        if accessible_pids is not None:
            db_sessions = [
                it for it in db_sessions
                if not (it.get("cwd") or "")
                or encode_project_id(it.get("cwd") or "") in accessible_pids
            ]

        # 过滤：仅保留无 project_root 的会话（纯 chat）
        non_project_sessions = [s for s in db_sessions if not s.get("project_root") and not s.get("cwd")]

        # 归档过滤
        _, non_project_sessions = self._filter_archived([], non_project_sessions)

        non_project_sessions.sort(key=lambda x: str(x.get("last_active") or ""), reverse=True)

        card = build_chats_card(
            chat_id=chat_id,
            sessions=non_project_sessions,
            active_session_id=state.active_session_id,
            expanded=expanded,
        )
        await lark_bridge.send_card(chat_id, card)

    async def _cmd_convos(self, chat_id: str, expanded: bool = False, current_user: Optional[dict] = None):
        """当前项目对话 — DB优先 + 文件扫描补充，含权限过滤（与 Web API 一致）"""
        from backend.services.card_builder import build_project_card
        from backend.services.chat_state import get_chat_state, save_chat_state
        from backend.services.project_discovery import discover_projects, find_project_root
        from backend.services.session_discovery import discover_sessions
        from backend.core.dependencies import get_accessible_project_ids, encode_project_id
        from pathlib import Path

        state = await get_chat_state(chat_id)

        # 权限信息
        accessible_pids = await get_accessible_project_ids(current_user)

        projects = discover_projects()
        # 过滤已归档项目
        projects, _ = self._filter_archived(projects, [])

        # 权限过滤项目列表
        if accessible_pids is not None:
            projects = [
                p for p in projects
                if encode_project_id(p.get("cwd") or "") in accessible_pids
            ]

        # 基于 cwd 推导当前项目
        effective_key = self._derive_project_key(state, [], projects)

        project = None
        if effective_key:
            project = next(
                (
                    p for p in projects
                    if p.get("id") == effective_key
                    or p.get("cwd") == effective_key
                ),
                None,
            )
        if not project and projects:
            project = projects[0]

        if not project:
            await lark_bridge.send_text(chat_id, "还没有找到 Agent 项目或对话。")
            return

        state.active_project_key = project.get("id") or project.get("cwd", "")
        project_cwd = project.get("cwd") or ""
        if project_cwd:
            state.cwd = project_cwd
        await save_chat_state(state)

        # DB 查询：获取该项目下的会话
        db_sessions: list[dict] = []
        if project_cwd:
            async with async_session_factory() as session:
                r = await session.execute(
                    sa_text(
                        """
                        SELECT session_id,
                               MAX(agent_id) as agent_id,
                               MAX(cwd) as cwd,
                               COUNT(*) as task_count,
                               MAX(status) as last_status,
                               MAX(created_at) as last_active
                        FROM tasks
                        WHERE workspace_id = 'default'
                          AND session_id IS NOT NULL
                          AND session_id != ''
                          AND (cwd = :project OR cwd LIKE :project_prefix)
                          AND id NOT IN (SELECT task_id FROM plan_tasks)
                        GROUP BY session_id
                        ORDER BY last_active DESC
                        """
                    ),
                    {"project": project_cwd, "project_prefix": project_cwd.rstrip("/") + "/%"},
                )
                for row in r.fetchall():
                    db_sessions.append({
                        "session_id": row[0],
                        "agent_id": row[1],
                        "cwd": row[2],
                        "task_count": row[3],
                        "last_status": row[4],
                        "last_active": row[5],
                        "source": "db",
                    })

        # 文件扫描补充
        file_sessions_list = discover_sessions(project_cwd=project_cwd)
        file_meta_map: dict[str, dict] = {}
        for s in file_sessions_list:
            sid = s.get("session_id")
            if sid:
                file_meta_map[sid] = s

        # 合并：DB 优先，用文件元数据丰富
        db_sids = {s["session_id"] for s in db_sessions}
        for db_s in db_sessions:
            sid = db_s.get("session_id") or ""
            file_s = file_meta_map.get(sid)
            if file_s:
                if not db_s.get("project_root"):
                    db_s["project_root"] = file_s.get("project_root")
                if not db_s.get("project_name"):
                    db_s["project_name"] = file_s.get("project_name")
                if not db_s.get("title"):
                    db_s["title"] = file_s.get("title")
            else:
                # 无对应文件时，从 cwd 计算 project_root
                cwd_val = db_s.get("cwd") or ""
                if cwd_val and not db_s.get("project_root"):
                    pr = find_project_root(Path(cwd_val))
                    if pr:
                        db_s["project_root"] = str(pr)
                        db_s["project_name"] = pr.name

        # 仅文件中存在的会话（DB 中无记录）
        for sid, s in file_meta_map.items():
            if sid in db_sids:
                continue
            db_sessions.append({
                "session_id": sid,
                "agent_id": s.get("agent_id"),
                "cwd": s.get("cwd"),
                "project_root": s.get("project_root"),
                "project_name": s.get("project_name"),
                "title": s.get("title"),
                "task_count": 1,
                "last_status": s.get("status") or "completed",
                "last_active": s.get("last_active"),
                "source": "file",
            })

        # 权限过滤（额外保护：确认用户有该项目访问权限）
        if accessible_pids is not None:
            db_sessions = [
                it for it in db_sessions
                if not (it.get("cwd") or "")
                or encode_project_id(it.get("cwd") or "") in accessible_pids
            ]

        # 归档过滤
        _, db_sessions = self._filter_archived([], db_sessions)

        db_sessions.sort(key=lambda x: str(x.get("last_active") or ""), reverse=True)

        card = build_project_card(
            chat_id=chat_id,
            project=project,
            sessions=db_sessions,
            active_session_id=state.active_session_id,
            expanded=expanded,
        )
        await lark_bridge.send_card(chat_id, card)

    async def _cmd_conv(self, chat_id: str, session_id: str):
        """选择并查看会话"""
        from backend.services.card_builder import build_conversation_card
        from backend.services.chat_state import get_chat_state, save_chat_state
        from backend.services.session_discovery import discover_sessions

        state = await get_chat_state(chat_id)
        sessions = discover_sessions()
        session = next(
            (
                s for s in sessions
                if s.get("session_id") == session_id or s.get("id") == session_id
            ),
            None,
        )

        if not session:
            await lark_bridge.send_text(chat_id, f"找不到对话：`{session_id}`")
            return

        state.active_session_id = session.get("session_id") or session.get("id", "")
        await save_chat_state(state)

        card = build_conversation_card(
            chat_id=chat_id,
            session=session,
            is_active=True,
        )
        await lark_bridge.send_card(chat_id, card)

    async def _cmd_project_by_number(self, chat_id: str, number_text: str):
        """按编号打开项目"""
        from backend.services.card_builder import build_project_card
        from backend.services.chat_state import get_chat_state, save_chat_state
        from backend.services.project_discovery import discover_projects
        from backend.services.session_discovery import discover_sessions

        try:
            index = int(number_text.strip()) - 1
        except ValueError:
            await lark_bridge.send_text(chat_id, "用法：/project <编号>，例如 /project 1")
            return

        projects = discover_projects()
        # Task #89: 过滤已归档项目
        projects, _ = self._filter_archived(projects, [])

        if index < 0 or index >= len(projects):
            await lark_bridge.send_text(
                chat_id, f"项目编号超出范围。当前共 {len(projects)} 个项目。"
            )
            return

        project = projects[index]
        state = await get_chat_state(chat_id)
        state.active_project_key = project.get("id") or project.get("cwd", "")
        project_cwd = project.get("cwd") or ""
        if project_cwd:
            state.cwd = project_cwd
        await save_chat_state(state)

        sessions = discover_sessions(project_cwd=project.get("cwd"))
        # Task #89: 过滤已归档会话
        _, sessions = self._filter_archived([], sessions)
        card = build_project_card(
            chat_id=chat_id,
            project=project,
            sessions=sessions,
            active_session_id=state.active_session_id,
            expanded=False,
        )
        await lark_bridge.send_card(chat_id, card)

    async def _cmd_latest_by_number(self, chat_id: str, number_text: str):
        """按项目编号打开最新会话"""
        from backend.services.card_builder import build_conversation_card
        from backend.services.chat_state import get_chat_state
        from backend.services.project_discovery import discover_projects
        from backend.services.session_discovery import discover_sessions

        try:
            index = int(number_text.strip()) - 1
        except ValueError:
            await lark_bridge.send_text(chat_id, "用法：/latest <项目编号>，例如 /latest 1")
            return

        projects = discover_projects()
        # Task #89: 过滤已归档项目
        projects, _ = self._filter_archived(projects, [])

        if index < 0 or index >= len(projects):
            await lark_bridge.send_text(
                chat_id, f"项目编号超出范围。当前共 {len(projects)} 个项目。"
            )
            return

        project = projects[index]
        sessions = discover_sessions(project_cwd=project.get("cwd"))
        # Task #89: 过滤已归档会话
        _, sessions = self._filter_archived([], sessions)
        if not sessions:
            await lark_bridge.send_text(chat_id, "这个项目没有对话。")
            return

        state = await get_chat_state(chat_id)
        latest = sessions[0]
        card = build_conversation_card(
            chat_id=chat_id,
            session=latest,
            is_active=(latest.get("session_id") == state.active_session_id),
        )
        await lark_bridge.send_card(chat_id, card)

    async def _handle_card_action(self, event: LarkEvent):
        """处理卡片按钮回调（分发到各 action handler）。"""
        import json as _json

        action_value: Any = event.raw_data.get("action") if event.raw_data else None
        # action_value 可能是 dict，也可能是 JSON 字符串
        if isinstance(action_value, str):
            try:
                action_value = _json.loads(action_value)
            except (TypeError, ValueError):
                action_value = {}
        if not isinstance(action_value, dict):
            action_value = {}

        action_name = (action_value.get("action") or "").strip()
        chat_id = (action_value.get("chat_id") or event.chat_id or "").strip()
        message_id = (event.message_id or "").strip()

        logger.info(
            "Card action dispatch action=%s chat=%s msg=%s value=%s",
            action_name or "-",
            chat_id[:8] if chat_id else "-",
            message_id[:8] if message_id else "-",
            str(action_value)[:120],
        )

        if not action_name:
            logger.debug("Card action without 'action' field, skipping")
            return

        handler = self._action_handlers().get(action_name)
        if handler is None:
            logger.warning("Unknown card action: %s", action_name)
            if chat_id:
                await lark_bridge.send_text(
                    chat_id, f"❓ 未知卡片操作：{action_name}"
                )
            return

        try:
            card = await handler(chat_id, action_value, message_id)
            # 统一处理返回的卡片：有 message_id 则原地更新，否则发新消息
            if card and isinstance(card, dict):
                if message_id:
                    await lark_bridge.update_card(message_id, card)
                elif chat_id:
                    await lark_bridge.send_card(chat_id, card)
        except Exception:
            logger.exception("Card action handler failed: %s", action_name)
            if chat_id:
                await lark_bridge.send_text(chat_id, f"❌ 操作失败：{action_name}")

    # ── 卡片按钮回调路由 ────────────────────────────────────

    def _action_handlers(self) -> dict:
        """action 名 → handler 方法映射（延迟构造，保证绑定 self）。"""
        return {
            "dashboard": self._action_dashboard,
            "project": self._action_project,
            "chats": self._action_chats,
            "conversation": self._action_conversation,
            "conversation_status": self._action_conversation_status,
            "latest_conversation": self._action_latest_conversation,
            "stop": self._action_stop,
            "daily": self._action_daily,
            "status": self._action_status,
            "approve": self._action_approve,
            "reject": self._action_reject,
            "mark_project_from_chat": self._action_mark_project_from_chat,
        }

    @staticmethod
    def _coerce_bool(value: Any, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() not in ("", "false", "0", "no", "off")
        return default

    async def _action_dashboard(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        from backend.services.card_builder import build_dashboard_card
        from backend.services.chat_state import get_chat_state
        from backend.services.project_discovery import discover_projects
        from backend.services.session_discovery import discover_sessions

        expanded = self._coerce_bool(value.get("expanded"), default=False)
        state = await get_chat_state(chat_id)
        projects = discover_projects()
        sessions = discover_sessions()

        # Task #89: 过滤已归档项目和会话
        projects, sessions = self._filter_archived(projects, sessions)

        # Task #88: 基于当前 session cwd 推导当前项目
        effective_project_key = self._derive_project_key(
            state, sessions, projects
        )

        card = build_dashboard_card(
            chat_id=chat_id,
            projects=projects,
            sessions=sessions,
            active_project_key=effective_project_key,
            active_session_id=state.active_session_id,
            cwd=state.cwd,
            expanded=expanded,
        )
        return card

    async def _action_project(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        from backend.services.card_builder import build_project_card
        from backend.services.chat_state import get_chat_state, save_chat_state
        from backend.services.project_discovery import discover_projects
        from backend.services.session_discovery import discover_sessions

        project_key = (value.get("project_key") or "").strip()
        expanded = self._coerce_bool(value.get("expanded"), default=False)

        projects = discover_projects()
        # Task #89: 过滤已归档项目
        projects, _ = self._filter_archived(projects, [])

        project = None
        if project_key:
            project = next(
                (
                    p for p in projects
                    if p.get("id") == project_key or p.get("cwd") == project_key
                ),
                None,
            )
        if not project and projects:
            project = projects[0]
        if not project:
            await lark_bridge.send_text(chat_id, "找不到项目。")
            return None

        state = await get_chat_state(chat_id)
        state.active_project_key = project.get("id") or project.get("cwd", "")
        project_cwd = project.get("cwd") or ""
        if project_cwd:
            state.cwd = project_cwd
        await save_chat_state(state)
        sessions = discover_sessions(project_cwd=project.get("cwd"))
        # Task #89: 过滤已归档会话
        _, sessions = self._filter_archived([], sessions)
        card = build_project_card(
            chat_id=chat_id,
            project=project,
            sessions=sessions,
            active_session_id=state.active_session_id,
            expanded=expanded,
        )
        return card

    async def _action_chats(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        from backend.services.card_builder import build_chats_card
        from backend.services.chat_state import get_chat_state
        from backend.services.session_discovery import discover_sessions

        expanded = self._coerce_bool(value.get("expanded"), default=True)
        state = await get_chat_state(chat_id)
        sessions = discover_sessions()
        # Task #89: 过滤已归档会话
        _, sessions = self._filter_archived([], sessions)
        non_project_sessions = [s for s in sessions if not s.get("project_root")]
        card = build_chats_card(
            chat_id=chat_id,
            sessions=non_project_sessions,
            active_session_id=state.active_session_id,
            expanded=expanded,
        )
        return card

    async def _action_conversation(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        from backend.services.card_builder import build_conversation_card
        from backend.services.chat_state import get_chat_state, save_chat_state
        from backend.services.session_discovery import discover_sessions

        session_id = (value.get("session_id") or "").strip()
        if not session_id:
            await lark_bridge.send_text(chat_id, "缺少 session_id 参数")
            return None

        sessions = discover_sessions()
        session = next(
            (s for s in sessions if s.get("session_id") == session_id or s.get("id") == session_id),
            None,
        )
        if not session:
            await lark_bridge.send_text(chat_id, f"找不到对话：`{session_id}`")
            return None

        state = await get_chat_state(chat_id)
        state.active_session_id = session.get("session_id") or session.get("id", "")
        await save_chat_state(state)
        card = build_conversation_card(
            chat_id=chat_id,
            session=session,
            is_active=True,
        )
        return card

    async def _action_conversation_status(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        session_id = (value.get("session_id") or "").strip()
        task_id = (value.get("task_id") or "").strip()

        # 优先：如果带 task_id，刷新任务卡片
        if task_id:
            try:
                task = await self.task_service.get_task(task_id)
            except Exception:
                logger.exception("get_task failed: %s", task_id[:8])
                task = None
            if task:
                from backend.services.card_builder import build_task_card
                payload = dict(task)
                payload.setdefault("chat_id", chat_id)
                return build_task_card(payload)

        # 其次：带 session_id，刷新会话卡片
        if session_id:
            from backend.services.card_builder import build_conversation_card
            from backend.services.chat_state import get_chat_state
            from backend.services.session_discovery import discover_sessions

            sessions = discover_sessions()
            session = next(
                (
                    s for s in sessions
                    if s.get("session_id") == session_id or s.get("id") == session_id
                ),
                None,
            )
            if not session:
                await lark_bridge.send_text(chat_id, f"找不到对话：`{session_id}`")
                return None
            state = await get_chat_state(chat_id)
            card = build_conversation_card(
                chat_id=chat_id,
                session=session,
                is_active=(session_id == state.active_session_id),
            )
            return card

        # 兆后：退化为任务状态总览
        from backend.services.card_builder import build_simple_notice_card
        tasks = await self.task_service.list_tasks(limit=5)
        lines = []
        for t in tasks:
            lines.append(f"• {t.get('status','-')} | {(t.get('prompt',''))[:40]}")
        return build_simple_notice_card("任务状态", "\n".join(lines) or "暂无任务", template="blue")

    async def _action_latest_conversation(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        from backend.services.card_builder import build_conversation_card
        from backend.services.chat_state import get_chat_state
        from backend.services.project_discovery import discover_projects
        from backend.services.session_discovery import discover_sessions

        project_key = (value.get("project_key") or "").strip()
        projects = discover_projects()
        # Task #89: 过滤已归档项目
        projects, _ = self._filter_archived(projects, [])
        project = None
        if project_key:
            project = next(
                (
                    p for p in projects
                    if p.get("id") == project_key or p.get("cwd") == project_key
                ),
                None,
            )
        if not project:
            await lark_bridge.send_text(chat_id, "找不到项目。")
            return None

        sessions = discover_sessions(project_cwd=project.get("cwd"))
        # Task #89: 过滤已归档会话
        _, sessions = self._filter_archived([], sessions)
        if not sessions:
            await lark_bridge.send_text(chat_id, "这个项目还没有对话。")
            return None

        state = await get_chat_state(chat_id)
        latest = sessions[0]
        card = build_conversation_card(
            chat_id=chat_id,
            session=latest,
            is_active=(latest.get("session_id") == state.active_session_id),
        )
        return card

    async def _action_stop(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        task_id = (value.get("task_id") or "").strip()
        if task_id:
            try:
                await self.task_service.stop_task(task_id)
                await lark_bridge.send_text(chat_id, f"✅ 已停止任务 {task_id[:8]}...")
            except Exception:
                logger.exception("stop_task failed: %s", task_id[:8])
                await lark_bridge.send_text(chat_id, "❌ 停止任务失败")
            return None
        await self._cmd_stop(chat_id, "/stop")
        return None

    async def _action_daily(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        # _cmd_daily 内部会 send_card/send_text，对于 daily 报告较复杂暂保持原逻辑
        await self._cmd_daily(chat_id, "/daily")
        return None

    async def _action_status(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        from backend.services.card_builder import build_simple_notice_card
        try:
            tasks = await self.task_service.list_tasks(limit=10)
            if not tasks:
                return build_simple_notice_card("任务状态", "暂无任务", template="blue")
            lines = []
            for t in tasks:
                status = t.get("status", "-")
                prompt = (t.get("prompt", "") or "")[:50]
                lines.append(f"• {status} | {prompt}")
            return build_simple_notice_card("任务状态", "\n".join(lines), template="blue")
        except Exception:
            logger.exception("_action_status failed")
            return None

    async def _action_approve(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        approval_id = (value.get("approval_id") or "").strip()
        if not approval_id:
            await lark_bridge.send_text(chat_id, "缺少 approval_id 参数")
            return None
        await self._cmd_approve(chat_id, approval_id, approved=True)
        return None

    async def _action_reject(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        approval_id = (value.get("approval_id") or "").strip()
        if not approval_id:
            await lark_bridge.send_text(chat_id, "缺少 approval_id 参数")
            return None
        await self._cmd_approve(chat_id, approval_id, approved=False)
        return None

    async def _action_mark_project_from_chat(self, chat_id: str, value: dict, message_id: str) -> Optional[dict]:
        if not chat_id:
            return None
        from backend.services.chat_state import get_chat_state, save_chat_state
        from backend.services.session_discovery import discover_sessions

        session_id = (value.get("session_id") or "").strip()
        if not session_id:
            await lark_bridge.send_text(chat_id, "缺少 session_id 参数")
            return None

        sessions = discover_sessions()
        session = next(
            (
                s for s in sessions
                if s.get("session_id") == session_id or s.get("id") == session_id
            ),
            None,
        )
        if not session:
            await lark_bridge.send_text(chat_id, f"找不到对话：`{session_id}`")
            return None

        cwd = (session.get("cwd") or "").strip()
        if not cwd:
            await lark_bridge.send_text(chat_id, "该会话没有工作目录，无法标记为项目")
            return None

        state = await get_chat_state(chat_id)
        state.active_project_key = cwd
        state.cwd = cwd
        await save_chat_state(state)

        from backend.services.card_builder import build_simple_notice_card
        return build_simple_notice_card(
            "已标记项目",
            f"✅ 已将对话目录标记为项目：\n`{cwd}`",
            template="green",
        )


# 全局单例
message_handler = MessageHandler()
