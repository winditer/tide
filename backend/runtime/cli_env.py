"""Agent CLI 子进程环境构建工具。

后端服务进程（尤其在 systemd/launchd/Docker 下）的 PATH 常常不包含用户级安装
目录 ``~/.local/bin``，导致 ``qodercli`` / ``codex`` / ``claude`` 等 CLI 无法被
exec 找到（报错 ``[Errno 2] No such file or directory``）。

本模块提供统一的 PATH 增强逻辑，供所有需要启动 Agent CLI 子进程的执行路径
复用（executor、task_service 预检、智能路由等），确保行为一致。
"""

import os
import shutil
from typing import Optional


def _extra_bin_dirs() -> list[str]:
    """常见的 Agent CLI 安装目录（按优先级排列，越靠前优先级越高）。"""
    home = os.path.expanduser("~")
    return [
        os.path.join(home, ".local", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]


def augmented_path(base_path: Optional[str] = None) -> str:
    """在给定 PATH 基础上，将常见 CLI 安装目录前置补充（缺失时才补充，避免重复）。"""
    path_value = os.environ.get("PATH", "") if base_path is None else base_path
    existing = path_value.split(os.pathsep) if path_value else []
    prepend = [d for d in _extra_bin_dirs() if d and d not in existing]
    if not prepend:
        return path_value
    return os.pathsep.join(prepend + existing) if existing else os.pathsep.join(prepend)


def build_subprocess_env(extra: Optional[dict[str, str]] = None) -> dict[str, str]:
    """构建子进程环境变量：确保 Agent CLI 安装目录在 PATH 中。

    :param extra: 需要额外注入/覆盖的环境变量（如 CODEX_HOME）。
    """
    env = os.environ.copy()
    env["PATH"] = augmented_path(env.get("PATH", ""))
    # 压制 Codex CLI (Rust) 的 tracing 日志（默认 error 级别，避免噪声混入输出）
    if not env.get("RUST_LOG"):
        env["RUST_LOG"] = "error"
    if extra:
        env.update(extra)
    return env


def which(bin_name: str) -> Optional[str]:
    """等价于 ``shutil.which``，但使用增强后的 PATH 进行查找。

    用于 CLI 预检，避免因后端进程 PATH 缺失 ``~/.local/bin`` 而误判 CLI 不存在。
    """
    if not bin_name:
        return None
    return shutil.which(bin_name, path=augmented_path())
