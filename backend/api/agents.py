"""
Agent 运行时状态 API。

返回可用 Agent 列表 + 运行时状态。
"""

import shutil

from fastapi import APIRouter

from backend.runtime.adapters import AGENT_ADAPTERS
from backend.runtime.task_runtime import TASKS

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("")
async def list_agents():
    """返回可用 Agent 列表 + 运行时状态"""
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
                "name": adapter.label,
                "available": bool(adapter.bin_name and shutil.which(adapter.bin_name)),
                "running_tasks": running,
                "queued_tasks": queued,
            }
        )
    return {"agents": agents}
