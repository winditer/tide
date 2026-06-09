"""
chat_state.py — 聊天运行时状态管理

基于 conversations 表的 metadata JSON 字段存储扩展状态。
核心字段（cwd, agent_id, model, session_id）同时持久化到对应列，
扩展字段（active_project_key, plan_input_mode 等）存储于 metadata JSON。
"""
import json
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text

from backend.db.engine import async_session_factory
from backend.services.conversation_service import conversation_service

DEFAULT_CWD = str(Path.home() / "Documents" / "lark2codex")


@dataclass
class ChatState:
    """单个 Lark 聊天的运行时状态"""
    chat_id: str
    conversation_id: str = ""          # conversations 表的 id
    cwd: str = ""                       # 当前工作目录
    active_project_key: str = ""        # 当前活跃项目标识 (路径)
    active_session_id: str = ""         # 当前活跃 Agent 会话 ID
    agent_id: str = "codex"             # 当前 Agent
    model: str = ""                     # 当前模型
    plan_input_mode: bool = False       # 是否在 Plan 输入模式


def _parse_metadata(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


async def get_chat_state(chat_id: str) -> ChatState:
    """从 DB 获取聊天状态（不存在则创建默认值）"""
    conv = await conversation_service.get_or_create(
        workspace_id="default", chat_id=chat_id
    )
    metadata = _parse_metadata(conv.get("metadata"))

    return ChatState(
        chat_id=chat_id,
        conversation_id=conv.get("id", ""),
        cwd=conv.get("cwd") or metadata.get("cwd") or DEFAULT_CWD,
        active_project_key=metadata.get("active_project_key", ""),
        active_session_id=conv.get("session_id") or metadata.get("active_session_id", ""),
        agent_id=conv.get("agent_id") or "codex",
        model=conv.get("model") or "",
        plan_input_mode=metadata.get("plan_input_mode", False),
    )


async def save_chat_state(state: ChatState) -> None:
    """将状态写回 DB（核心字段写入对应列，扩展字段写入 metadata JSON）"""
    metadata = {
        "active_project_key": state.active_project_key,
        "active_session_id": state.active_session_id,
        "plan_input_mode": state.plan_input_mode,
        "cwd": state.cwd,
    }
    async with async_session_factory() as session:
        await session.execute(
            text("""
                UPDATE conversations
                SET cwd = :cwd,
                    agent_id = :agent_id,
                    model = :model,
                    session_id = :session_id,
                    metadata = :metadata,
                    last_active_at = datetime('now')
                WHERE id = :conv_id
            """),
            {
                "cwd": state.cwd,
                "agent_id": state.agent_id,
                "model": state.model,
                "session_id": state.active_session_id or None,
                "metadata": json.dumps(metadata, ensure_ascii=False),
                "conv_id": state.conversation_id,
            },
        )
        await session.commit()


async def update_cwd(chat_id: str, new_cwd: str) -> ChatState:
    """切换工作目录并重置会话状态（active_project_key 由调用方按需设置）"""
    state = await get_chat_state(chat_id)
    state.cwd = new_cwd
    state.active_session_id = ""
    await save_chat_state(state)
    return state
