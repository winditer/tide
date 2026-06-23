"""配置管理模块。

通过环境变量加载 Bridge 服务的运行配置。所有配置都集中在此处，
方便在容器或 systemd 启动脚本中通过环境变量覆盖。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any


def _env_str(key: str, default: str = "") -> str:
    val = os.environ.get(key)
    return val if val is not None and val != "" else default


def _env_int(key: str, default: int) -> int:
    raw = os.environ.get(key)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _env_bool(key: str, default: bool = False) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _load_agents_override() -> dict[str, dict[str, Any]] | None:
    """允许通过 BRIDGE_AGENTS 环境变量覆盖 Agent 配置（JSON 字符串）。"""
    raw = os.environ.get("BRIDGE_AGENTS")
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


@dataclass
class AgentConfig:
    """单个 Agent CLI 的配置。"""

    bin: str
    model: str = ""
    timeout: int = 600
    # 默认审批/沙箱策略，可被请求级 configuration 覆盖
    approval_policy: str = "on-request"
    sandbox_mode: str = "workspace-write"
    permission_mode: str = "acceptEdits"
    extra_args: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentConfig":
        return cls(
            bin=str(data.get("bin", "")),
            model=str(data.get("model", "") or ""),
            timeout=int(data.get("timeout", 600) or 600),
            approval_policy=str(data.get("approval_policy", "on-request") or "on-request"),
            sandbox_mode=str(data.get("sandbox_mode", "workspace-write") or "workspace-write"),
            permission_mode=str(data.get("permission_mode", "acceptEdits") or "acceptEdits"),
            extra_args=list(data.get("extra_args") or []),
        )


# ---------------- 服务监听 ----------------
BRIDGE_HOST: str = _env_str("BRIDGE_HOST", "0.0.0.0")
BRIDGE_PORT: int = _env_int("BRIDGE_PORT", 8720)

# 公开访问 URL（用于 Agent Card 中的 url 字段）。如果未设置，将根据请求自动推导。
PUBLIC_URL: str = _env_str("BRIDGE_PUBLIC_URL", "")

# ---------------- 认证 ----------------
# 当 API_KEY 为空字符串时表示禁用认证。建议生产环境必须配置。
API_KEY: str = _env_str("BRIDGE_API_KEY", "")

# ---------------- 工作目录 ----------------
WORK_DIR: str = _env_str("BRIDGE_WORK_DIR", "/home/deploy/workspace")

# ---------------- 并发与超时 ----------------
MAX_CONCURRENCY: int = _env_int("BRIDGE_MAX_CONCURRENCY", 5)
DEFAULT_TIMEOUT: int = _env_int("BRIDGE_DEFAULT_TIMEOUT", 600)

# ---------------- 默认 Agent ----------------
DEFAULT_AGENT: str = _env_str("BRIDGE_DEFAULT_AGENT", "codex")

# ---------------- 日志 ----------------
LOG_LEVEL: str = _env_str("BRIDGE_LOG_LEVEL", "INFO")

# ---------------- Git 配置 ----------------
# 仓库本地存储目录（每个仓库会以 org_repo 命名子目录）
GIT_REPOS_DIR: str = _env_str("GIT_REPOS_DIR", "/tmp/a2a-repos")
# SSH 私钥路径（用于 git@ 协议）
GIT_SSH_KEY_PATH: str = _env_str("GIT_SSH_KEY_PATH", "")
# HTTPS 认证 token（用于 https:// 协议）
GIT_AUTH_TOKEN: str = _env_str("GIT_AUTH_TOKEN", "")
# 默认仓库 URL（当请求未携带 git.repoUrl 时使用）
GIT_DEFAULT_REPO: str = _env_str("GIT_DEFAULT_REPO", "")
# 默认基线分支
GIT_DEFAULT_BRANCH: str = _env_str("GIT_DEFAULT_BRANCH", "main")
# 是否在任务结束后自动 push
GIT_AUTO_PUSH: bool = _env_bool("GIT_AUTO_PUSH", True)

# ---------------- Agent CLI 配置 ----------------
_DEFAULT_AGENTS: dict[str, dict[str, Any]] = {
    "codex": {
        "bin": _env_str("CODEX_BIN", "codex"),
        "model": _env_str("CODEX_MODEL", "auto"),
        "timeout": _env_int("CODEX_TIMEOUT", DEFAULT_TIMEOUT),
        "approval_policy": _env_str("CODEX_APPROVAL_POLICY", "on-request"),
        "sandbox_mode": _env_str("CODEX_SANDBOX_MODE", "workspace-write"),
    },
    "claude": {
        "bin": _env_str("CLAUDE_BIN", "claude"),
        "model": _env_str("CLAUDE_MODEL", ""),
        "timeout": _env_int("CLAUDE_TIMEOUT", DEFAULT_TIMEOUT),
        "permission_mode": _env_str("CLAUDE_PERMISSION_MODE", "acceptEdits"),
    },
    "qoder": {
        "bin": _env_str("QODER_BIN", "qoder"),
        "model": _env_str("QODER_MODEL", ""),
        "timeout": _env_int("QODER_TIMEOUT", DEFAULT_TIMEOUT),
        "permission_mode": _env_str("QODER_PERMISSION_MODE", "acceptEdits"),
    },
}

_override = _load_agents_override()
_raw_agents = _override if _override is not None else _DEFAULT_AGENTS

AGENTS: dict[str, AgentConfig] = {
    name: AgentConfig.from_dict(cfg) for name, cfg in _raw_agents.items()
}


def get_agent_config(skill: str | None) -> tuple[str, AgentConfig]:
    """根据 skill 名称取出 Agent 配置；若未指定或不存在则回退到默认 Agent。"""
    name = (skill or "").strip().lower()
    if name and name in AGENTS:
        return name, AGENTS[name]
    if DEFAULT_AGENT in AGENTS:
        return DEFAULT_AGENT, AGENTS[DEFAULT_AGENT]
    # 退而求其次：取第一个可用 Agent
    if AGENTS:
        first = next(iter(AGENTS.items()))
        return first[0], first[1]
    raise RuntimeError("No agents configured")


def list_agents() -> list[str]:
    return sorted(AGENTS.keys())
