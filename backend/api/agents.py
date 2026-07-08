"""
Agent 运行时状态 API。

返回可用 Agent 列表 + 运行时状态。
本地 Agent (codex/claude/qoder) 来自 AGENT_ADAPTERS；
远程 A2A Agent 来自 remote_agents 表。
配置覆盖层来自 agent_configs 表（支持全局/项目/个人三级作用域）。
"""

import json
import logging
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from backend.core.dependencies import get_optional_user
from backend.db.engine import async_session_factory
from backend.runtime.adapters import AGENT_ADAPTERS
from backend.runtime.task_runtime import TASKS
from backend.services.agent_config_service import agent_config_service

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
                    " capabilities_streaming, capabilities_push_notifications,"
                    " scope, scope_target"
                    " FROM remote_agents WHERE status = 'active'"
                )
            )
            rows = result.fetchall()
    except Exception as exc:  # pragma: no cover - 降级路径
        logger.warning("list remote_agents failed: %s", exc)
        return []

    agents: list[dict] = []
    for row in rows:
        (
            agent_id,
            name,
            description,
            skills_json,
            streaming,
            push,
            scope,
            scope_target,
        ) = row
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
                # 远程 Agent 在 remote_agents 表中自带作用域（注册时确定），
                # 作为列表作用域图标的兜底来源，避免"未额外配置覆盖"时误显示为灰色。
                "scope": (scope or "global"),
                "scope_target": scope_target or None,
                "capabilities": {
                    "streaming": bool(streaming),
                    "pushNotifications": bool(push),
                },
            }
        )
    return agents


def _apply_config_overrides(
    agents: list[dict],
    configs: dict[str, dict],
) -> list[dict]:
    """应用 agent_configs 配置覆盖层。

    - enabled=0 的 Agent 被过滤掉
    - display_name / description / model_override 等字段覆盖默认值
    """
    result: list[dict] = []
    for agent in agents:
        agent_id = agent.get("id", "")
        cfg = configs.get(agent_id)
        if cfg:
            # disabled → 跳过
            if cfg.get("enabled") == 0:
                continue
            # 覆盖显示名
            if cfg.get("display_name"):
                agent["name"] = cfg["display_name"]
            # 覆盖描述
            if cfg.get("description"):
                agent["description"] = cfg["description"]
            # 附加模型覆盖信息
            if cfg.get("model_override"):
                agent["model_override"] = cfg["model_override"]
            if cfg.get("timeout_override"):
                agent["timeout_override"] = cfg["timeout_override"]
            if cfg.get("config_json"):
                agent["config"] = cfg["config_json"]
        result.append(agent)
    return result


@router.get("")
async def list_agents(
    project_id: Optional[str] = Query(None),
    overrides: bool = Query(
        True,
        description="是否应用 agent_configs 配置覆盖层（禁用过滤 + 字段覆盖）。"
        "管理页需要原始完整列表时传 false。",
    ),
    current_user=Depends(get_optional_user),
):
    """返回可用 Agent 列表 + 运行时状态（含远程 A2A Agent + 配置覆盖）。

    - ``overrides=true``（默认）：应用配置覆盖层，禁用的 Agent 被过滤，
      供各业务场景（任务/计划/对话/专家团等）选择时使用。
    - ``overrides=false``：返回原始完整列表（含被禁用的 Agent），
      供 Agent 管理页展示与配置。
    """
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

    # 应用 agent_configs 配置覆盖层（管理页可通过 overrides=false 跳过）
    if overrides:
        user_id = current_user.get("id") if current_user else None
        try:
            configs = await agent_config_service.resolve_configs(
                user_id=user_id,
                project_id=project_id,
            )
            if configs:
                agents = _apply_config_overrides(agents, configs)
        except Exception as exc:
            logger.warning("apply agent_configs overrides failed: %s", exc)

    return {"agents": agents}
