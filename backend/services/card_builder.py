"""Lark 交互卡片构建工具（纯函数）。

从 lark2agent_ws.py 抽取的卡片原语与模板：
- 原语函数（normalize_lark_md/button/md/...）：原样保留
- 卡片模板（dashboard/project/chats/conversation）：改为接受外部数据参数，
  不再依赖全局 RUNTIMES / build_index()，便于在 FastAPI / 测试中复用。

数据契约：
- ``projects``  来自 :func:`backend.services.project_discovery.discover_projects`
- ``sessions``  来自 :func:`backend.services.session_discovery.discover_sessions`
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

# ---------- 常量 ----------

APP_NAME = "Lark2Agent"
MAX_PROJECTS_IN_PANEL = 8
MAX_CONVERSATIONS_IN_PANEL = 10
LARK_CARD_ENABLE_FORWARD = True


# ---------- 文本工具 ----------


def normalize_lark_md(content: str) -> str:
    """将常见 Markdown 转换为 Lark 卡片可靠渲染的子集（heading -> bold）。"""
    lines: list[str] = []
    in_fence = False
    fence_marker = ""

    for line in str(content or "").splitlines():
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = ""
            lines.append(line)
            continue

        if not in_fence:
            heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
            if heading:
                line = f"**{heading.group(2).strip()}**"

        lines.append(line)

    return "\n".join(lines)


def short_text(text: str, max_len: int = 100) -> str:
    """折叠空白并截断长文本（保持与旧代码兼容的省略号）。"""
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def format_time(value: Any) -> str:
    """将 ISO 字符串或 Unix 时间戳格式化为 ``MM-DD HH:MM``。"""
    if value is None or value == "":
        return "-"
    dt: Optional[datetime] = None
    if isinstance(value, (int, float)):
        try:
            dt = datetime.fromtimestamp(float(value))
        except (OverflowError, OSError, ValueError):
            return "-"
    elif isinstance(value, str):
        # 兼容形如 "2025-01-01T12:34:56(.000)?(Z|+08:00)?"
        text = value.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            try:
                dt = datetime.fromtimestamp(float(value))
            except (TypeError, ValueError, OverflowError, OSError):
                return value
    if dt is None:
        return str(value)
    return dt.strftime("%m-%d %H:%M")


# ---------- 卡片原语 ----------


def button(
    text: str,
    action: str,
    value: dict[str, Any],
    style: str = "default",
) -> dict[str, Any]:
    payload = {"action": action, **(value or {})}
    return {
        "tag": "button",
        "text": {"tag": "plain_text", "content": text},
        "type": style,
        "value": payload,
    }


def compact_button(
    text: str,
    action: str,
    value: dict[str, Any],
    style: str = "default",
) -> dict[str, Any]:
    item = button(text, action, value, style)
    item["size"] = "small"
    return item


def md(content: str) -> dict[str, Any]:
    return {"tag": "div", "text": {"tag": "lark_md", "content": normalize_lark_md(content)}}


def fields(items: list[tuple[str, str]]) -> dict[str, Any]:
    return {
        "tag": "column_set",
        "flex_mode": "none",
        "background_style": "grey",
        "columns": [
            {
                "tag": "column",
                "width": "weighted",
                "weight": 1,
                "elements": [md(f"**{label}**\n{value}")],
            }
            for label, value in items
        ],
    }


def divider() -> dict[str, Any]:
    return {"tag": "hr"}


def note(content: str) -> dict[str, Any]:
    return {
        "tag": "note",
        "elements": [{"tag": "lark_md", "content": normalize_lark_md(content)}],
    }


def action_row(actions: list[dict[str, Any]]) -> dict[str, Any]:
    return {"tag": "action", "actions": actions}


def base_card(
    title: str,
    elements: list[dict[str, Any]],
    template: str = "blue",
) -> dict[str, Any]:
    return {
        "config": {"wide_screen_mode": True, "enable_forward": LARK_CARD_ENABLE_FORWARD},
        "header": {
            "template": template,
            "title": {"tag": "plain_text", "content": title},
        },
        "elements": elements,
    }


# ---------- 内部辅助 ----------


def _agents_text(agents: Any) -> str:
    if not agents:
        return "-"
    if isinstance(agents, (list, tuple, set)):
        return " / ".join(str(a) for a in agents) or "-"
    return str(agents)


def _find_project(projects: list[dict], project_id: str) -> Optional[dict]:
    if not project_id:
        return None
    for p in projects:
        if p.get("id") == project_id or p.get("cwd") == project_id:
            return p
    return None


# ---------- 卡片模板 ----------


def build_dashboard_card(
    chat_id: str,
    projects: list[dict],
    sessions: list[dict],
    active_project_key: str = "",
    active_session_id: str = "",
    cwd: str = "",
    expanded: bool = False,
) -> dict[str, Any]:
    """主看板卡片。

    - ``projects``: 项目列表（来自 project_discovery.discover_projects）
    - ``sessions``: 全部会话列表（来自 session_discovery.discover_sessions）
                    其中 project_root 为空的视为 "普通对话"
    - ``active_project_key``: 当前聚焦的项目 id（即项目根路径）
    - ``active_session_id``: 当前活跃会话 id
    """

    chats = [s for s in sessions if not s.get("project_root")]
    current_project = (
        _find_project(projects, active_project_key)
        or (projects[0] if projects else None)
    )

    # 当前 session 显示
    active_session_title = ""
    for s in sessions:
        if s.get("session_id") == active_session_id or s.get("id") == active_session_id:
            active_session_title = s.get("title", "") or ""
            break

    elements: list[dict[str, Any]] = [
        fields(
            [
                ("项目", str(len(projects))),
                ("普通对话", str(len(chats))),
                ("状态", "空闲"),
            ]
        ),
        md(f"**当前目录**\n`{cwd or '-'}`"),
        md(
            "**当前 Session**\n"
            f"{active_session_title or '-'}\n"
            f"`{active_session_id or '-'}`"
        ),
        md(
            "**当前项目**\n"
            f"{current_project.get('name') if current_project else '暂无'}"
            + (
                f" · {format_time(current_project.get('last_active'))}"
                if current_project and current_project.get("last_active")
                else ""
            )
        ),
        action_row(
            [
                compact_button(
                    "刷新", "dashboard", {"chat_id": chat_id, "expanded": expanded}, "primary"
                ),
                compact_button(
                    "收起项目" if expanded else "展开项目",
                    "dashboard",
                    {"chat_id": chat_id, "expanded": not expanded},
                ),
                compact_button("状态", "status", {"chat_id": chat_id}),
                compact_button("日报", "daily", {"chat_id": chat_id}),
                compact_button("普通对话", "chats", {"chat_id": chat_id}),
                compact_button("停止", "stop", {"chat_id": chat_id}, "danger"),
            ]
        ),
    ]

    if not expanded:
        elements.extend(
            [
                divider(),
                note(
                    "项目看板已收起。点击“展开项目”，或发送 /projects 展开；"
                    "按钮不可用时可继续用 /project 1、/latest 1。"
                ),
            ]
        )
        return base_card(f"{APP_NAME} 看板", elements)

    elements.extend([divider(), md("**项目看板**")])
    if not projects:
        elements.append(md("还没有识别到项目会话。普通对话可发送 /chats 查看。"))

    for idx, project in enumerate(projects[:MAX_PROJECTS_IN_PANEL], 1):
        active_mark = (
            "（当前）" if current_project and project.get("id") == current_project.get("id") else ""
        )
        latest = format_time(project.get("last_active"))
        cwd_str = str(project.get("cwd") or "无项目目录")
        agents_text = _agents_text(project.get("agents"))
        elements.append(
            md(
                f"**{idx}. {project.get('name', '-')}** {active_mark}\n"
                f"对话 {project.get('task_count', 0)} · 最近 {latest}\n"
                f"Agent {agents_text}\n"
                f"`{short_text(cwd_str, 100)}`"
            )
        )
        elements.append(
            action_row(
                [
                    compact_button(
                        "打开项目",
                        "project",
                        {"chat_id": chat_id, "project_key": project.get("id", "")},
                        "primary",
                    ),
                    compact_button(
                        "最新对话",
                        "latest_conversation",
                        {"chat_id": chat_id, "project_key": project.get("id", "")},
                    ),
                ]
            )
        )

    if len(projects) > MAX_PROJECTS_IN_PANEL:
        elements.append(
            note(f"仅显示最近 {MAX_PROJECTS_IN_PANEL} 个项目；可调 MAX_PROJECTS_IN_PANEL。")
        )
    return base_card(f"{APP_NAME} 看板", elements)


def build_project_card(
    chat_id: str,
    project: dict,
    sessions: list[dict],
    active_session_id: str = "",
    expanded: bool = False,
) -> dict[str, Any]:
    """项目详情卡片。

    - ``project``: 单个项目字典（含 id/name/cwd/task_count/agents/last_active）
    - ``sessions``: 该项目下的会话列表
    """

    if not project:
        return base_card(
            "项目不存在",
            [
                md("该项目可能已经没有可读取的会话记录。"),
                action_row(
                    [compact_button("返回看板", "dashboard", {"chat_id": chat_id}, "primary")]
                ),
            ],
            "red",
        )

    project_id = project.get("id", "")
    agents_text = _agents_text(project.get("agents"))

    active_session_title = ""
    for s in sessions:
        if s.get("session_id") == active_session_id or s.get("id") == active_session_id:
            active_session_title = s.get("title", "") or ""
            break

    elements: list[dict[str, Any]] = [
        fields(
            [
                ("项目", project.get("name", "-")),
                ("对话", str(len(sessions) or project.get("task_count", 0))),
            ]
        ),
        md(f"**目录**\n`{project.get('cwd') or '无项目目录'}`"),
        md(
            "**当前 Session**\n"
            f"{active_session_title or '-'}\n"
            f"`{active_session_id or '-'}`"
        ),
        md(f"**Agent**\n{agents_text}"),
        action_row(
            [
                compact_button(
                    "返回看板", "dashboard", {"chat_id": chat_id, "expanded": False}
                ),
                compact_button(
                    "收起对话" if expanded else "展开对话",
                    "project",
                    {
                        "chat_id": chat_id,
                        "project_key": project_id,
                        "expanded": not expanded,
                    },
                    "primary",
                ),
                compact_button(
                    "项目进展",
                    "daily",
                    {"chat_id": chat_id, "project_key": project_id},
                    "primary",
                ),
            ]
        ),
    ]

    if not expanded:
        elements.extend(
            [
                divider(),
                note("对话列表已收起。点击“展开对话”，或发送 /convos 展开。"),
            ]
        )
        return base_card(f"{project.get('name', '-')} / 对话", elements, "turquoise")

    elements.extend([divider(), md("**最近对话**")])
    for idx, conv in enumerate(sessions[:MAX_CONVERSATIONS_IN_PANEL], 1):
        sid = conv.get("session_id") or conv.get("id", "")
        active_mark = "（当前）" if sid and sid == active_session_id else ""
        elements.append(
            md(
                f"**{idx}. {conv.get('title', '-')}** {active_mark}\n"
                f"{conv.get('agent_id', '-')} · {conv.get('status', '-')} · {format_time(conv.get('last_active'))}\n"
                f"`{sid}`"
            )
        )
        elements.append(
            action_row(
                [
                    compact_button(
                        "切换",
                        "conversation",
                        {"chat_id": chat_id, "session_id": sid},
                        "primary",
                    ),
                    compact_button(
                        "状态",
                        "conversation_status",
                        {"chat_id": chat_id, "session_id": sid},
                    ),
                ]
            )
        )
    if len(sessions) > MAX_CONVERSATIONS_IN_PANEL:
        elements.append(
            note(f"仅显示最近 {MAX_CONVERSATIONS_IN_PANEL} 个对话；可调 MAX_CONVERSATIONS_IN_PANEL。")
        )
    return base_card(f"{project.get('name', '-')} / 对话", elements, "turquoise")


def build_chats_card(
    chat_id: str,
    sessions: list[dict],
    active_session_id: str = "",
    expanded: bool = True,
) -> dict[str, Any]:
    """普通对话（非项目）卡片。

    - ``sessions``: 已经过滤好的非项目会话列表
    """

    elements: list[dict[str, Any]] = [
        fields(
            [
                ("普通对话", str(len(sessions))),
                ("状态", "已展开" if expanded else "已收起"),
                ("当前", active_session_id or "-"),
            ]
        ),
        action_row(
            [
                compact_button("返回看板", "dashboard", {"chat_id": chat_id}, "primary"),
                compact_button(
                    "刷新", "chats", {"chat_id": chat_id, "expanded": expanded}, "primary"
                ),
                compact_button(
                    "展开" if not expanded else "收起",
                    "chats",
                    {"chat_id": chat_id, "expanded": not expanded},
                ),
            ]
        ),
    ]

    if not expanded:
        elements.append(note("普通对话列表已收起。发送 /chats 展开。"))
        return base_card("普通对话", elements, "grey")

    if not sessions:
        elements.append(md("暂未识别到普通对话。"))
        return base_card("普通对话", elements, "grey")

    for idx, conv in enumerate(sessions[:MAX_CONVERSATIONS_IN_PANEL], 1):
        sid = conv.get("session_id") or conv.get("id", "")
        active_mark = "（当前）" if sid and sid == active_session_id else ""
        cwd_str = str(conv.get("cwd") or "无目录")
        elements.append(divider())
        elements.append(
            md(
                f"**{idx}. {conv.get('title', '-')}** {active_mark}\n"
                f"{conv.get('agent_id', '-')} · {conv.get('status', '-')} · {format_time(conv.get('last_active'))}\n"
                f"`{short_text(cwd_str, 100)}`\n"
                f"`{sid}`"
            )
        )
        elements.append(
            action_row(
                [
                    compact_button(
                        "切换",
                        "conversation",
                        {"chat_id": chat_id, "session_id": sid},
                        "primary",
                    ),
                    compact_button(
                        "标为项目",
                        "mark_project_from_chat",
                        {"chat_id": chat_id, "session_id": sid},
                    ),
                ]
            )
        )

    if len(sessions) > MAX_CONVERSATIONS_IN_PANEL:
        elements.append(note(f"仅显示最近 {MAX_CONVERSATIONS_IN_PANEL} 个普通对话。"))
    return base_card("普通对话", elements, "grey")


def build_conversation_card(
    chat_id: str,
    session: dict,
    is_active: bool = False,
) -> dict[str, Any]:
    """单个会话详情卡片。

    - ``session``: 会话字典（来自 session_discovery）
    - ``is_active``: 是否为当前活跃会话（影响按钮与说明文案）
    """

    if not session:
        return base_card(
            "对话不存在",
            [
                md("找不到对话。"),
                action_row(
                    [compact_button("返回看板", "dashboard", {"chat_id": chat_id}, "primary")]
                ),
            ],
            "red",
        )

    sid = session.get("session_id") or session.get("id", "")
    project_root = session.get("project_root") or ""
    project_name = session.get("project_name") or ""

    back_button = (
        compact_button(
            "返回项目",
            "project",
            {"chat_id": chat_id, "project_key": project_root},
        )
        if project_root
        else compact_button(
            "返回普通对话",
            "chats",
            {"chat_id": chat_id, "expanded": True},
        )
    )

    action_buttons = [
        back_button,
        compact_button(
            "刷新",
            "conversation_status",
            {"chat_id": chat_id, "session_id": sid},
            "primary",
        ),
    ]
    if not is_active:
        action_buttons.append(
            compact_button(
                "切换",
                "conversation",
                {"chat_id": chat_id, "session_id": sid},
                "primary",
            )
        )
    action_buttons.append(
        compact_button("停止", "stop", {"chat_id": chat_id}, "danger")
    )

    elements = [
        fields(
            [
                ("状态", session.get("status", "-")),
                ("Agent", session.get("agent_id", "-")),
                ("来源", session.get("source", "-")),
            ]
        ),
        md(f"**标题**\n{session.get('title', '-')}"),
        md(
            f"**目录**\n`{session.get('cwd') or '-'}`\n"
            f"**Session**：`{sid or '-'}`"
            + (f"\n**项目**：{project_name}" if project_name else "")
        ),
        action_row(action_buttons),
        divider(),
        md(f"**最近提问**\n{short_text(session.get('title', ''), 500) or '无'}"),
        md(
            "直接在聊天里发送文字会继续当前对话。"
            if is_active
            else "这是查看模式；点击“切换”后，后续文字才会继续这个对话。"
        ),
    ]
    return base_card("当前对话", elements, "green")


# ---------- 任务卡片 ----------


_TASK_TEMPLATE_MAP = {
    "running": "blue",
    "queued": "wathet",
    "pending": "wathet",
    "waiting": "wathet",
    "completed": "green",
    "success": "green",
    "done": "green",
    "failed": "red",
    "error": "red",
    "stopped": "grey",
    "cancelled": "grey",
    "review": "orange",
    "approval_request": "orange",
    "approved": "green",
    "rejected": "red",
}


def _format_duration_ms(value: Any) -> str:
    if value in (None, ""):
        return "-"
    try:
        seconds = int(value) / 1000.0
    except (TypeError, ValueError):
        return "-"
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, secs = divmod(int(seconds), 60)
    if minutes < 60:
        return f"{minutes}m{secs:02d}s"
    hours, mins = divmod(minutes, 60)
    return f"{hours}h{mins:02d}m"


def build_task_card(task_data: dict) -> dict[str, Any]:
    """任务状态卡片（纯函数，供 lark_bridge.send_task_card 调用）。

    支持字段：``id`` / ``task_id``、``chat_id``、``status``、``prompt``、
    ``agent_id``、``cwd``、``model``、``session_id``、``result``、``duration_ms``。
    按照状态推导卡片色与可用按钮（停止/审批/查看详情/看板）。
    """

    chat_id = str(task_data.get("chat_id") or "")
    task_id = str(task_data.get("id") or task_data.get("task_id") or "")
    status = str(task_data.get("status") or "unknown")
    prompt = str(task_data.get("prompt") or "")
    agent_id = str(task_data.get("agent_id") or "-")
    cwd = str(task_data.get("cwd") or "-")
    model = str(task_data.get("model") or "-")
    session_id = str(task_data.get("session_id") or "")
    result = str(task_data.get("result") or "")
    duration_text = _format_duration_ms(task_data.get("duration_ms"))

    status_lower = status.lower()
    template = _TASK_TEMPLATE_MAP.get(status_lower, "blue")

    task_fields = [
        ("状态", status),
        ("Agent", agent_id),
        ("模型", model),
        ("耗时", duration_text),
    ]

    elements: list[dict[str, Any]] = [
        fields(task_fields),
        md(f"**指令**\n{short_text(prompt, 600) or '无'}"),
        md(f"**目录**\n`{cwd}`"),
    ]
    if task_id:
        elements.append(md(f"**任务 ID**\n`{task_id}`"))
    if session_id:
        elements.append(md(f"**Session**\n`{session_id}`"))
    if result:
        elements.extend([divider(), md(f"**最新结果**\n{short_text(result, 1500)}")])

    actions: list[dict[str, Any]] = [
        compact_button(
            "查看详情",
            "conversation_status",
            {"chat_id": chat_id, "task_id": task_id, "session_id": session_id},
            "primary",
        ),
    ]
    if status_lower in ("running", "queued", "pending", "waiting"):
        actions.append(
            compact_button(
                "停止",
                "stop",
                {"chat_id": chat_id, "task_id": task_id},
                "danger",
            )
        )
    if status_lower in ("review", "approval_request"):
        actions.extend(
            [
                compact_button(
                    "批准",
                    "approve",
                    {"chat_id": chat_id, "task_id": task_id},
                    "primary",
                ),
                compact_button(
                    "拒绝",
                    "reject",
                    {"chat_id": chat_id, "task_id": task_id},
                    "danger",
                ),
            ]
        )
    actions.append(
        compact_button("看板", "dashboard", {"chat_id": chat_id})
    )
    elements.append(action_row(actions))

    return base_card(f"{APP_NAME} 任务", elements, template)


# ---------- 通用通知卡片 ----------


def build_simple_notice_card(
    title: str,
    content: str,
    *,
    template: str = "blue",
    back_action: Optional[str] = None,
    back_label: str = "返回",
) -> dict[str, Any]:
    """通用通知卡片：标题 + 一段 Markdown 文本，可选返回按钮。

    - ``title``: 卡片标题（header）
    - ``content``: 主体文本（按 lark_md 渲染）
    - ``template``: header 配色（blue/red/green/grey/orange/turquoise/wathet）
    - ``back_action``: 若提供，则末尾追加一个返回按钮，其 action 即该字符串
      （用于 ``card_action_handler`` 的扁平字符串路由）。
    - ``back_label``: 返回按钮的文案。
    """

    elements: list[dict[str, Any]] = [md(content or "")]
    if back_action:
        elements.append(
            action_row([compact_button(back_label, back_action, {})])
        )
    return base_card(title, elements, template)


# ---------- Plan 卡片 ----------


_PLAN_TEMPLATE_MAP = {
    "active": "blue",
    "running": "blue",
    "queued": "wathet",
    "pending": "wathet",
    "waiting": "wathet",
    "completed": "green",
    "success": "green",
    "done": "green",
    "failed": "red",
    "error": "red",
    "stopped": "grey",
    "cancelled": "grey",
}


_PLAN_TASK_RUNNING = ("running", "queued", "pending", "waiting")
_PLAN_TASK_REVIEW = ("review", "approval_request")
_PLAN_TASK_RETRYABLE = ("failed", "error", "stopped", "rejected", "cancelled")
_PLAN_TASK_DONE = ("completed", "success", "done")


def _plan_field(value: Any, default: str = "-") -> Any:
    """兼容 dict / 对象的字段读取。"""
    if value is None:
        return default
    return value


def _plan_get(plan: Any, key: str, default: Any = None) -> Any:
    if plan is None:
        return default
    if isinstance(plan, dict):
        return plan.get(key, default)
    return getattr(plan, key, default)


def build_plan_card(plan: Any) -> dict[str, Any]:
    """Plan 状态卡片。

    ``plan`` 可为 dict 或具备同名属性的对象，期望字段：
    - ``id`` / ``status`` / ``cwd`` / ``name`` / ``title``
    - ``tasks``: list[dict]，每项含 ``id`` / ``status`` / ``prompt`` /
      ``title`` / ``agent_id`` / ``phase`` / ``task_index`` / ``depends_on``

    按钮 ``action`` 采用扁平字符串格式，与 ``card_action_handler``
    （``plan_*`` / ``plan_task_*``）一致。
    """

    if not plan:
        return build_simple_notice_card(
            "Plan 不存在", "找不到 Plan，可能已被删除。", template="red"
        )

    plan_id = str(_plan_get(plan, "id") or "")
    status = str(_plan_get(plan, "status") or "unknown")
    cwd = str(_plan_get(plan, "cwd") or "-")
    name = str(
        _plan_get(plan, "name")
        or _plan_get(plan, "title")
        or (plan_id[:8] if plan_id else "-")
    )
    tasks = list(_plan_get(plan, "tasks") or [])

    counters = {"completed": 0, "failed": 0, "running": 0, "review": 0, "pending": 0}
    for t in tasks:
        st = str(_plan_get(t, "status") or "").lower()
        if st in _PLAN_TASK_DONE:
            counters["completed"] += 1
        elif st in ("failed", "error"):
            counters["failed"] += 1
        elif st == "running":
            counters["running"] += 1
        elif st in _PLAN_TASK_REVIEW:
            counters["review"] += 1
        else:
            counters["pending"] += 1

    status_lower = status.lower()
    template = _PLAN_TEMPLATE_MAP.get(status_lower, "blue")

    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", status),
                ("任务", str(len(tasks))),
                ("完成", str(counters["completed"])),
                ("失败", str(counters["failed"])),
            ]
        ),
        md(f"**Plan**\n{name}" + (f"\n`{plan_id}`" if plan_id else "")),
        md(f"**目录**\n`{cwd}`"),
    ]

    if counters["running"] or counters["review"] or counters["pending"]:
        elements.append(
            note(
                f"运行中 {counters['running']} · 待审批 {counters['review']} · 待执行 {counters['pending']}"
            )
        )

    if tasks:
        elements.append(divider())
        elements.append(md("**任务列表**"))

        for idx, t in enumerate(tasks, 1):
            tid = str(_plan_get(t, "id") or "")
            tstatus = str(_plan_get(t, "status") or "-")
            ttitle = str(
                _plan_get(t, "title")
                or _plan_get(t, "prompt")
                or "-"
            )
            agent = str(_plan_get(t, "agent_id") or "-")
            phase = _plan_get(t, "phase")
            phase_text = str(phase) if phase not in (None, "") else "-"
            duration = _format_duration_ms(_plan_get(t, "duration_ms"))

            elements.append(
                md(
                    f"**{idx}. [{tstatus}] {short_text(ttitle, 80)}**\n"
                    f"Agent {agent} · 阶段 {phase_text} · 耗时 {duration}"
                    + (f"\n`{tid}`" if tid else "")
                )
            )

            if not tid or not plan_id:
                continue

            row_actions: list[dict[str, Any]] = []
            tlower = tstatus.lower()
            if tlower in _PLAN_TASK_REVIEW:
                row_actions.append(
                    compact_button(
                        "批准", f"plan_approve_{plan_id}_{tid}", {}, "primary"
                    )
                )
                row_actions.append(
                    compact_button(
                        "拒绝", f"plan_reject_{plan_id}_{tid}", {}, "danger"
                    )
                )
            if tlower in _PLAN_TASK_RUNNING:
                row_actions.append(
                    compact_button(
                        "停止", f"plan_task_stop_{plan_id}_{tid}", {}, "danger"
                    )
                )
            if tlower in _PLAN_TASK_RETRYABLE:
                row_actions.append(
                    compact_button(
                        "重试", f"plan_task_retry_{plan_id}_{tid}", {}, "primary"
                    )
                )
            row_actions.append(
                compact_button("详情", f"plan_task_detail_{plan_id}_{tid}", {})
            )
            elements.append(action_row(row_actions))
    else:
        elements.append(note("该 Plan 暂无任务。"))

    plan_actions: list[dict[str, Any]] = []
    if plan_id:
        plan_actions.append(
            compact_button("刷新", f"plan_refresh_{plan_id}", {}, "primary")
        )
        if status_lower in ("active", "running", "pending", "queued"):
            plan_actions.append(
                compact_button("停止", f"plan_stop_{plan_id}", {}, "danger")
            )
        if counters["failed"] > 0:
            plan_actions.append(
                compact_button("重试失败", f"plan_retry_failed_{plan_id}", {})
            )
        plan_actions.append(
            compact_button("详情", f"plan_detail_{plan_id}", {})
        )
        elements.append(action_row(plan_actions))

    return base_card(f"{APP_NAME} Plan", elements, template)
