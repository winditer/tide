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
from backend.core.scope_utils import match_project_scope
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
                    "SELECT ra.id, ra.name, ra.description, ra.skills_json,"
                    " ra.capabilities_streaming, ra.capabilities_push_notifications,"
                    " ra.scope, ra.scope_target, ra.created_by,"
                    " COALESCE(u.display_name, u.username, ra.created_by) AS created_by_name"
                    " FROM remote_agents ra"
                    " LEFT JOIN users u ON ra.created_by = u.id"
                    " WHERE ra.status = 'active'"
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
            created_by,
            created_by_name,
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
                "created_by": created_by,
                "created_by_name": created_by_name or created_by,
                "capabilities": {
                    "streaming": bool(streaming),
                    "pushNotifications": bool(push),
                },
            }
        )
    return agents


def _agent_visible_for_scope(
    agent: dict,
    cfg: Optional[dict],
    project_id: Optional[str],
    user_id: Optional[str],
    project_group_ids: Optional[set] = None,
) -> bool:
    """判断 Agent 是否在当前用户/项目上下文下有权使用（作用域权限过滤）。

    - ``global`` 作用域：所有人可见
    - ``project`` 作用域：仅目标项目（``scope_target == project_id``）成员可见；
      若 ``scope_target`` 为 ``group:<gid>`` 则匹配项目所属组
    - ``personal`` 作用域：仅目标用户（``scope_target == user_id``）可见

    有效作用域优先取 agent_configs 覆盖，其次取 Agent 自带 scope（远程 Agent
    在 remote_agents 表中的注册作用域），最后默认 ``global``（本地 Agent）。
    """
    if cfg and cfg.get("scope"):
        scope = cfg.get("scope")
        target = cfg.get("scope_target")
    else:
        scope = agent.get("scope") or "global"
        target = agent.get("scope_target")

    if scope == "project":
        if not project_id or not target:
            return False
        # target 兼容单项目 ID、JSON 数组（多选）、group:<gid> 前端（项目组）
        return match_project_scope(target, project_id, project_group_ids)
    if scope == "personal":
        return bool(user_id) and target == user_id
    # global 或未知作用域 → 所有人可见
    return True


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
    scope_filter: bool = Query(
        False,
        description="为 true 时按作用域权限过滤，仅返回当前用户/项目有权使用的 Agent"
        "（global 所有人可用；project 仅目标项目成员；personal 仅目标用户）。"
        "供 @mention 等选择场景使用。",
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

    # 解析 agent_configs 三级作用域配置（覆盖过滤与作用域权限过滤共用）
    user_id = current_user.get("id") if current_user else None
    configs: dict[str, dict] = {}
    if overrides or scope_filter:
        try:
            configs = await agent_config_service.resolve_configs(
                user_id=user_id,
                project_id=project_id,
            )
        except Exception as exc:
            logger.warning("resolve agent_configs failed: %s", exc)
            configs = {}

    # 应用 agent_configs 配置覆盖层（禁用过滤 + 字段覆盖；管理页可通过 overrides=false 跳过）
    if overrides and configs:
        agents = _apply_config_overrides(agents, configs)

    # 查询当前项目所属的所有 project group（用于 scope_filter 中的组匹配）
    project_group_ids: set = set()
    if scope_filter and project_id:
        try:
            async with async_session_factory() as session:
                rows = await session.execute(
                    text(
                        "SELECT group_id FROM project_group_members WHERE project_id = :pid"
                    ),
                    {"pid": project_id},
                )
                project_group_ids = {r[0] for r in rows.fetchall()}
        except Exception as exc:
            logger.warning("query project_group_members failed: %s", exc)

    # 按作用域权限过滤：仅保留当前用户/项目有权使用的 Agent
    if scope_filter:
        # 获取所有 project-scope 的 configs（不经过 resolve，因为一个 agent 可能有多条）
        all_project_configs: dict[str, list[dict]] = {}
        if project_id:
            try:
                async with async_session_factory() as session:
                    rows = await session.execute(
                        text(
                            "SELECT agent_id, scope, scope_target FROM agent_configs "
                            "WHERE workspace_id = 'default' AND scope = 'project'"
                        ),
                    )
                    for r in rows.fetchall():
                        aid = r[0]
                        if aid not in all_project_configs:
                            all_project_configs[aid] = []
                        all_project_configs[aid].append(
                            {"scope": r[1], "scope_target": r[2]}
                        )
            except Exception as exc:
                logger.warning("query all project configs failed: %s", exc)

        def is_visible(agent: dict) -> bool:
            agent_id = agent.get("id", "")
            # 先检查 resolved config（优先级最高的覆盖）
            cfg = configs.get(agent_id)
            if _agent_visible_for_scope(
                agent, cfg, project_id, user_id, project_group_ids
            ):
                return True
            # 再检查该 agent 的所有 project configs（多选情况）
            for pc in all_project_configs.get(agent_id, []):
                if _agent_visible_for_scope(
                    agent, pc, project_id, user_id, project_group_ids
                ):
                    return True
            return False

        agents = [a for a in agents if is_visible(a)]

    return {"agents": agents}
