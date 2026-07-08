"""Agent Card 生成。

A2A 协议要求服务在 `/.well-known/agent.json` 端点暴露元数据，
供平台通过 URL 自动发现 Agent 能力（streaming / skills / auth 等）。
"""
from __future__ import annotations

from typing import Any

import bridge_config as config


_SKILL_META: dict[str, dict[str, str]] = {
    "codex": {
        "name": "Codex CLI",
        "description": "OpenAI Codex agent for autonomous coding tasks (codex exec --json).",
    },
    "claude": {
        "name": "Claude Code",
        "description": "Anthropic Claude Code agent (claude --print --output-format stream-json).",
    },
    "qoder": {
        "name": "Qoder CLI",
        "description": "Qoder coding agent (qoder --print --output-format stream-json).",
    },
}


# 每个 CLI Agent 对外暴露的能力标签（用于 A2A 协议扩展的 agents 列表）。
_AGENT_CAPABILITIES: dict[str, list[str]] = {
    "codex": ["code", "review"],
    "claude": ["code", "review", "docs"],
    "qoder": ["code", "review"],
}

# agents 列表中使用的简短描述（区别于 skills 中较详细的描述）。
_AGENT_DESCRIPTIONS: dict[str, str] = {
    "codex": "OpenAI Codex CLI Agent",
    "claude": "Anthropic Claude Code CLI Agent",
    "qoder": "Qoder CLI Agent",
}


def _skill_entry(name: str) -> dict[str, Any]:
    meta = _SKILL_META.get(name, {})
    return {
        "id": name,
        "name": meta.get("name", name.title()),
        "description": meta.get("description", f"{name} CLI agent"),
        "tags": ["coding", "cli", name],
        "inputModes": ["text/plain"],
        "outputModes": ["text/plain"],
    }


def _agent_entry(name: str, bridge_name: str = "") -> dict[str, Any]:
    """构造 agents 列表中的单个 Agent 条目（A2A 协议扩展字段）。"""
    display_name = f"{bridge_name}/{name}" if bridge_name else name
    return {
        "name": display_name,
        "description": _AGENT_DESCRIPTIONS.get(name, f"{name} CLI agent"),
        "capabilities": list(_AGENT_CAPABILITIES.get(name, ["code"])),
    }


def build_agent_card(public_url: str | None = None) -> dict[str, Any]:
    """构造 Agent Card。

    public_url 不传时回退到 config.PUBLIC_URL 或本地默认地址。
    """
    url = (public_url or config.PUBLIC_URL or f"http://{config.BRIDGE_HOST}:{config.BRIDGE_PORT}").rstrip("/")
    auth_required = bool(config.API_KEY)
    agent_names = config.list_agents()
    bridge_name = config.resolve_bridge_name()
    skills = [_skill_entry(name) for name in agent_names]
    # A2A 协议扩展：列出当前已配置可用的具体 CLI Agent，
    # 供平台在 HTTP 发现模式下识别并注册为独立的子 Agent。
    agents = [_agent_entry(name, bridge_name) for name in agent_names]

    card: dict[str, Any] = {
        "name": "Tide CLI Bridge",
        "description": "Bridge service that wraps Codex/Claude/Qoder CLI as A2A agents.",
        "url": f"{url}/a2a",
        "provider": {
            "organization": "Tide",
            "url": url,
        },
        "version": "1.0.0",
        "protocolVersion": "0.2.5",
        "capabilities": {
            "streaming": True,
            "pushNotifications": False,
            "stateTransitionHistory": True,
        },
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": skills,
        "agents": agents,
    }

    if auth_required:
        card["securitySchemes"] = {
            "apiKey": {
                "type": "apiKey",
                "in": "header",
                "name": "X-API-Key",
            }
        }
        card["security"] = [{"apiKey": []}]
        # 兼容旧字段
        card["authentication"] = {"schemes": ["apiKey"]}
    else:
        card["authentication"] = {"schemes": []}

    return card
