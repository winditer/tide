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

from backend.services.lark_listener import LarkEvent
from backend.services.lark_bridge import lark_bridge
from backend.services.conversation_service import conversation_service

logger = logging.getLogger("lark2agent.message_handler")

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

        # /cd — 切换工作目录
        if content.lower().startswith("/cd "):
            await self._cmd_cd(chat_id, content[4:].strip())
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
            await self._cmd_plan(chat_id, content)
            return

        # /projects, /项目 — 项目面板
        if content in ("/projects", "/项目", "/projects 展开", "/项目 展开"):
            expanded = "展开" in content
            await self._cmd_projects(chat_id, expanded=expanded)
            return

        # /chats, /普通对话 — 对话列表
        if content in ("/chats", "/普通对话", "/chats 收起", "/普通对话 收起"):
            expanded = "收起" not in content
            await self._cmd_chats(chat_id, expanded=expanded)
            return

        # /convos, /对话 — 当前项目会话
        if content in ("/convos", "/对话", "/convos 展开", "/对话 展开"):
            expanded = "展开" in content
            await self._cmd_convos(chat_id, expanded=expanded)
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
                await self._plan_create(chat_id, content)
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

        # /daily — 每日进度报告
        if content.lower().startswith("/daily"):
            await self._cmd_daily(chat_id, content)
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
        await self._cmd_create_task(chat_id, content, event)

    # ── 指令处理器 ─────────────────────────────────────────

    async def _cmd_create_task(self, chat_id: str, prompt: str, event: LarkEvent):
        """创建任务"""
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
            logger.info(
                "Task created from Lark: task_id=%s agent=%s",
                task_id[:8],
                agent_id,
            )
            # 1) 广播到前端 WebSocket
            await lark_bridge.on_lark_task_created(task)
            # 2) 在 Lark 群里回复任务卡片（失败不影响主流程）
            try:
                payload = dict(task)
                payload.setdefault("chat_id", chat_id)
                payload.setdefault("agent_id", agent_id)
                payload.setdefault("prompt", prompt)
                message_id = await lark_bridge.send_task_card(payload)
                if message_id:
                    logger.info(
                        "Lark task card sent task=%s message=%s",
                        task_id[:8], message_id,
                    )
            except Exception:
                logger.exception("Failed to send Lark task card")
        except Exception:
            logger.exception("Failed to create task from Lark message")
            await lark_bridge.send_text(chat_id, "❌ 任务创建失败，请稍后重试")

    async def _cmd_help(self, chat_id: str):
        """显示帮助信息"""
        help_text = (
            "📖 Lark2Agent 指令大全\n"
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
            "• /cd <path> — 切换工作目录\n"
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
            "📝 Plan 类\n"
            "• /plan — 进入计划输入模式\n"
            "• /plan <描述> — 创建执行计划\n"
            "• /plan status — 查看计划状态\n"
            "• /plan stop — 停止当前计划\n"
            "\n"
            "⚙️ 配置类\n"
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

    async def _cmd_plan(self, chat_id: str, content: str):
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
            await self._plan_status(chat_id)
            return

        # /plan stop | /plan 停止
        if sub in ("stop", "停止"):
            await self._plan_stop(chat_id)
            return

        # /plan <tasks> — 创建新 Plan
        await self._plan_create(chat_id, plan_content)

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

    async def _plan_status(self, chat_id: str):
        """查询最新 Plan 状态"""
        try:
            from backend.services.plan_service import plan_service

            plans = await plan_service.list_plans(workspace_id="default", limit=1)
            items = plans if isinstance(plans, list) else (
                plans.get("items", []) if isinstance(plans, dict) else []
            )
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

    async def _plan_stop(self, chat_id: str):
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
            if plan.get("status") not in ("active",):
                await lark_bridge.send_text(chat_id, f"Plan `{plan_id[:8]}` 已经结束")
                return
            await plan_service.stop_plan(plan_id)
            await lark_bridge.send_text(chat_id, f"✅ 已停止 Plan `{plan_id[:8]}`")
        except Exception:
            logger.exception("Failed to stop plan")
            await lark_bridge.send_text(chat_id, "❌ 停止 Plan 失败")

    async def _plan_create(self, chat_id: str, plan_content: str):
        """从文本创建新 Plan"""
        from backend.services.chat_state import get_chat_state, save_chat_state

        state = await get_chat_state(chat_id)
        state.plan_input_mode = False
        await save_chat_state(state)

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

    async def _cmd_cd(self, chat_id: str, path_text: str):
        """切换工作目录"""
        from pathlib import Path
        from backend.services.chat_state import get_chat_state, save_chat_state
        from backend.services.project_discovery import find_project_root

        if not path_text:
            await lark_bridge.send_text(chat_id, "用法：/cd <目录>")
            return

        state = await get_chat_state(chat_id)
        path = Path(path_text).expanduser()
        if not path.is_absolute():
            path = Path(state.cwd) / path
        try:
            path = path.resolve()
        except OSError as e:
            await lark_bridge.send_text(chat_id, f"目录解析失败：{e}")
            return

        if not path.exists():
            await lark_bridge.send_text(chat_id, f"目录不存在：{path}")
            return
        if not path.is_dir():
            await lark_bridge.send_text(chat_id, f"不是目录：{path}")
            return

        state.cwd = str(path)
        root = find_project_root(path)
        state.active_project_key = str(root) if root else str(path)
        state.active_session_id = ""
        await save_chat_state(state)

        project_text = f"\n项目：`{root}`" if root and root != path else ""
        await lark_bridge.send_text(
            chat_id,
            f"✅ 已切换目录：`{path}`{project_text}\n后续新指令会在该目录启动新的会话。"
        )

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

    async def _cmd_daily(self, chat_id: str, content: str):
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

        # 获取当日会话
        try:
            sessions = discover_sessions(project_cwd=state.active_project_key or state.cwd)
        except Exception:
            logger.exception("discover_sessions failed")
            sessions = []
        today_str = report_date.isoformat()
        today_sessions = [
            s for s in sessions
            if s.get("last_active", "").startswith(today_str)
            or s.get("created_at", "").startswith(today_str)
        ]

        # Git 摘要
        git_summary = ""
        try:
            result = subprocess.run(
                ["git", "log", f"--since={today_str}", "--oneline", "--no-merges", "-20"],
                capture_output=True, text=True, timeout=5,
                cwd=state.cwd,
            )
            if result.returncode == 0 and result.stdout.strip():
                git_summary = result.stdout.strip()
        except Exception:
            pass

        # 构建报告
        lines = [f"📊 **{report_date} 进度报告**\n"]
        lines.append(f"项目目录：`{state.cwd}`")
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

    async def _cmd_projects(self, chat_id: str, expanded: bool = False):
        """项目面板"""
        from backend.services.card_builder import build_dashboard_card
        from backend.services.chat_state import get_chat_state
        from backend.services.project_discovery import discover_projects, find_project_root
        from backend.services.session_discovery import discover_sessions
        from pathlib import Path

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
        await lark_bridge.send_card(chat_id, card)

    async def _cmd_chats(self, chat_id: str, expanded: bool = True):
        """普通对话列表"""
        from backend.services.card_builder import build_chats_card
        from backend.services.chat_state import get_chat_state
        from backend.services.session_discovery import discover_sessions

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
        await lark_bridge.send_card(chat_id, card)

    async def _cmd_convos(self, chat_id: str, expanded: bool = False):
        """当前项目对话"""
        from backend.services.card_builder import build_project_card
        from backend.services.chat_state import get_chat_state, save_chat_state
        from backend.services.project_discovery import discover_projects
        from backend.services.session_discovery import discover_sessions

        state = await get_chat_state(chat_id)
        projects = discover_projects()
        # Task #89: 过滤已归档项目
        projects, _ = self._filter_archived(projects, [])

        # Task #88: 基于 cwd 推导当前项目
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
