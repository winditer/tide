"""
Agent 运行时状态 API。

返回可用 Agent 列表 + 运行时状态。
本地 Agent (codex/claude/qoder) 来自 AGENT_ADAPTERS；
远程 A2A Agent 来自 remote_agents 表。
"""

import json
import logging
import shutil

from fastapi import APIRouter, Depends
from sqlalchemy import text

from backend.core.dependencies import get_optional_user
from backend.db.engine import async_session_factory
from backend.runtime.adapters import AGENT_ADAPTERS
from backend.runtime.task_runtime import TASKS

router = APIRouter(prefix="/api/agents", tags=["agents"])

logger = logging.getLogger(__name__)


async def _list_remote_agents() -> list[dict]:
    """查询 remote_agents 表中所有 status='active' 的远程 Agent。

    任何异常都会被吞掉并返回空列表，保证本地 Agent 列表的可用性（降级策略）。
    """
    try:
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, name, description, skills_json,"
                    " capabilities_streaming, capabilities_push_notifications"
                    " FROM remote_agents WHERE status = 'active'"
                )
            )
            rows = result.fetchall()
    except Exception as exc:  # pragma: no cover - 降级路径
        logger.warning("list remote_agents failed: %s", exc)
        return []

    agents: list[dict] = []
    for row in rows:
        agent_id, name, description, skills_json, streaming, push = row
        try:
            skills = json.loads(skills_json) if skills_json else []
        except (TypeError, ValueError):
            skills = []
        agents.append(
            {
                "id": f"a2a:{agent_id}",
                "type": "remote",
                "name": name,
                "description": description,
                "status": "active",
                "skills": skills,
                "capabilities": {
                    "streaming": bool(streaming),
                    "pushNotifications": bool(push),
                },
            }
        )
    return agents


@router.get("")
async def list_agents(current_user=Depends(get_optional_user)):
    """返回可用 Agent 列表 + 运行时状态（含远程 A2A Agent）"""
    agents = []
    for agent_id, adapter in AGENT_ADAPTERS.items():
        running = sum(
            1 for t in TASKS.values() if t.agent_id == agent_id and t.status == "running"
        )
        queued = sum(
            1 for t in TASKS.values() if t.agent_id == agent_id and t.status == "queued"
        )
        agents.append(
            {
                "id": agent_id,
                "type": "local",
                "name": adapter.label,
                "available": bool(adapter.bin_name and shutil.which(adapter.bin_name)),
                "running_tasks": running,
                "queued_tasks": queued,
            }
        )

    # 追加远程 Agent；查询失败时降级为只返回本地列表
    agents.extend(await _list_remote_agents())

    return {"agents": agents}
